import type { FilledRegion, PcbBoard, Zone, ZoneFillState } from "../types";
import { canonicalJson, canonicalJsonValue } from "../revision";
import { stableHash } from "../smart-routing/hash";
import { computeFill } from "./compute-fill";
import { makeEffectiveClearance } from "./types";
import type { ComputeFillResult } from "./types";

export const ZONE_FILL_ALGORITHM_VERSION = "sirkit.zone-fill.v2" as const;

function hash(value: unknown): string {
  const material = canonicalJson(value);
  return `${stableHash(`zone-fill:a\0${material}`)}${stableHash(`zone-fill:b\0${material}`)}`;
}

/** Inputs that can change a pour. Derived fills, lifecycle state and UI/history are deliberately absent. */
export function zoneFillInputRevision(board: PcbBoard): string {
  return `zfi-${hash(canonicalJsonValue({
    algorithmVersion: ZONE_FILL_ALGORITHM_VERSION,
    outline: board.outline,
    nets: board.nets.map((net) => ({ id: net.id, stableId: net.stableId })).sort((a, b) => a.id - b.id),
    footprints: board.footprints.map((footprint) => ({
      id: footprint.id,
      at: footprint.at,
      rotationDeg: footprint.rotationDeg,
      side: footprint.side,
      padNets: footprint.padNets,
      pads: footprint.def.pads,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    tracks: [...board.tracks].sort((a, b) => a.id.localeCompare(b.id)),
    vias: [...board.vias].sort((a, b) => a.id.localeCompare(b.id)),
    zones: board.zones.map((zone) => ({
      id: zone.id,
      layer: zone.layer,
      netId: zone.netId,
      source: zone.source ?? "user",
      sourceLayerId: zone.sourceLayerId,
      priority: zone.priority ?? 0,
      polygon: zone.polygon,
      connection: zone.connection,
      clearanceOverrideNm: zone.clearanceOverrideNm,
      thermal: zone.thermal,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    netClassing: board.netClassing,
    constraintProgramHash: board.constraintState?.activeProgram?.programHash,
    routingKeepouts: board.routingKeepouts,
  }))}`;
}

export function zoneFillHash(regions: readonly FilledRegion[]): string {
  return `zfh-${hash([...regions].map((region) => ({
    outer: region.outer,
    holes: region.holes,
    boundingBox: region.boundingBox,
    areaNm2: region.areaNm2,
  })).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))))}`;
}

export function zoneFillIsCurrent(board: PcbBoard, zone: Zone): boolean {
  const state = zone.fillState;
  return zone.dirty === false
    && state?.status === "current"
    && state.algorithmVersion === ZONE_FILL_ALGORITHM_VERSION
    && state.sourceRevision === zoneFillInputRevision(board)
    && state.fillHash === zoneFillHash(zone.fill);
}

export function markZoneFillDirty(zone: Zone, sourceRevision = "pending"): void {
  zone.fill = [];
  zone.dirty = true;
  zone.fillState = {
    status: "dirty",
    algorithmVersion: ZONE_FILL_ALGORITHM_VERSION,
    sourceRevision,
    diagnostics: [],
  };
}

export interface ZoneFillCandidate {
  zoneId: string;
  sourceRevision: string;
  regions: FilledRegion[];
  state: ZoneFillState;
  result: ComputeFillResult;
}

export function computeZoneFillCandidate(board: PcbBoard, zone: Zone): ZoneFillCandidate {
  const sourceRevision = zoneFillInputRevision(board);
  try {
    const result = computeFill({ board, zone, effectiveClearance: makeEffectiveClearance(board, zone) });
    const filledAreaNm2 = result.regions.reduce((sum, region) => sum + region.areaNm2, 0);
    const fillHash = zoneFillHash(result.regions);
    return {
      zoneId: zone.id,
      sourceRevision,
      regions: result.regions,
      state: {
        status: "current",
        algorithmVersion: ZONE_FILL_ALGORITHM_VERSION,
        sourceRevision,
        fillHash,
        diagnostics: [],
        stats: {
          rawRegions: result.stats.rawRegions,
          regions: result.regions.length,
          islandsDropped: result.stats.islandsDropped,
          filledAreaNm2,
          thermalAccessCount: result.stats.thermalAccessCount ?? 0,
        },
      },
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown zone-fill failure.";
    return {
      zoneId: zone.id,
      sourceRevision,
      regions: [],
      state: {
        status: "failed",
        algorithmVersion: ZONE_FILL_ALGORITHM_VERSION,
        sourceRevision,
        diagnostics: [{ code: "ZONE_FILL_FAILED", message }],
      },
      result: { regions: [], stats: { rawRegions: 0, islandsDropped: 0, elapsedMs: 0, thermalAccessCount: 0 } },
    };
  }
}

/** Atomic compare-and-commit. A result for any earlier board revision is rejected byte-for-byte. */
export function applyZoneFillCandidate(board: PcbBoard, candidate: ZoneFillCandidate): boolean {
  if (zoneFillInputRevision(board) !== candidate.sourceRevision) return false;
  const zone = board.zones.find((item) => item.id === candidate.zoneId);
  if (!zone) return false;
  zone.fill = structuredClone(candidate.regions);
  zone.fillState = structuredClone(candidate.state);
  zone.dirty = candidate.state.status !== "current";
  return true;
}

export function invalidateAllZoneFills(board: PcbBoard): void {
  const revision = zoneFillInputRevision(board);
  for (const zone of board.zones) markZoneFillDirty(zone, revision);
}

/** Refill every zone against one immutable input revision, then commit all statuses to a clone. */
export function refillZoneFillsAtomically(board: PcbBoard): PcbBoard {
  if (board.zones.length === 0) return board;
  const candidates = board.zones.map((zone) => computeZoneFillCandidate(board, zone));
  const result = structuredClone(board);
  for (const candidate of candidates) applyZoneFillCandidate(result, candidate);
  return result;
}
