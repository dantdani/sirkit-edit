import type { PcbBoard } from "./types";
import { stableHash } from "./smart-routing/hash";
import { padSemanticKey } from "./pad-identity";
import { resolveVia } from "./padstack/registry";
import { compareCodePoints } from "@/app/lib/stable-compare";

export const PCB_REVISION_SCHEMA = "sirkit.pcb-revision.v2" as const;

export function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => compareCodePoints(a, b))
      .map(([key, child]) => [key, canonicalJsonValue(child)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

const byId = <T extends { id: string }>(a: T, b: T): number => compareCodePoints(a.id, b.id);

/** Semantic routing/electrical/manufacturing state; UI and history are absent. */
export function pcbRevisionPayload(board: PcbBoard): unknown {
  const footprints = [...board.footprints].sort(byId).map((footprint) => ({
    id: footprint.id,
    ref: footprint.ref,
    footprintId: footprint.footprintId,
    at: footprint.at,
    rotationDeg: footprint.rotationDeg,
    side: footprint.side,
    locked: footprint.locked,
    bodyMayOverhang: footprint.bodyMayOverhang,
    placementConstraints: footprint.placementConstraints,
    padNets: footprint.padNets,
    pinPadMappings: [...(footprint.pinPadMappings ?? [])]
      .map((mapping) => ({ ...mapping, padNumbers: [...mapping.padNumbers].sort() }))
      .sort((a, b) => compareCodePoints(a.endpointKey, b.endpointKey) || compareCodePoints(a.symbolPinNumber, b.symbolPinNumber)),
    footprintPadClassifications: footprint.footprintPadClassifications,
    syncIdentity: footprint.syncIdentity,
    def: {
      ...footprint.def,
      pads: [...footprint.def.pads].sort((a, b) => compareCodePoints(padSemanticKey(a), padSemanticKey(b))),
      graphics: [...footprint.def.graphics].sort((a, b) => compareCodePoints(canonicalJson(a), canonicalJson(b))),
      models: [...footprint.def.models].sort((a, b) => compareCodePoints(canonicalJson(a), canonicalJson(b))),
    },
  }));
  const nets = [...board.nets]
    .map((net) => ({ ...net, endpointKeys: [...(net.endpointKeys ?? [])].sort() }))
    .sort((a, b) => compareCodePoints(a.stableId ?? "", b.stableId ?? "") || a.id - b.id);
  const stackupConfig = board.stackupConfig
    ? {
        ...board.stackupConfig,
        copperLayers: [...board.stackupConfig.copperLayers].sort((a, b) => a.order - b.order || compareCodePoints(a.id, b.id)),
      }
    : undefined;
  const netClassing = board.netClassing
    ? {
        ...board.netClassing,
        ruleDeltas: [...board.netClassing.ruleDeltas]
          .map((delta) => ({
            ...delta,
            changes: [...delta.changes].map((change) => change.appliesTo.kind === "nets"
              ? { ...change, appliesTo: { ...change.appliesTo, netIds: [...change.appliesTo.netIds].sort((a, b) => a - b) } }
              : change),
          }))
          .sort((a, b) => compareCodePoints(a.createdAt, b.createdAt) || compareCodePoints(a.id, b.id)),
      }
    : undefined;
  const vias = [...board.vias].sort(byId).map((via) => {
    return {
      id: via.id,
      at: via.at,
      netId: via.netId,
      layers: via.layers,
      source: via.source,
      locked: via.locked,
      resolvedPadstack: resolveVia(board, via),
    };
  });
  const activeRoutingPadstack = board.routingPreferences?.viaMode === "padstack"
    ? board.padstacks?.find((padstack) => padstack.id === board.routingPreferences?.viaPadstackId)
    : undefined;
  return canonicalJsonValue({
    schema: PCB_REVISION_SCHEMA,
    formatVersion: board.formatVersion,
    stackup: board.stackup,
    stackupConfig,
    outline: board.outline,
    nets,
    footprints,
    tracks: [...board.tracks].sort(byId),
    vias,
    zones: [...board.zones].sort(byId).map((zone) => ({
      ...zone,
      fill: [...zone.fill].sort((a, b) => compareCodePoints(canonicalJson(a), canonicalJson(b))),
    })),
    texts: [...board.texts].sort(byId),
    silkItems: [...(board.silkItems ?? [])].sort(byId),
    activeRoutingPadstack,
    routingPreferences: board.routingPreferences,
    routingKeepouts: [...(board.routingKeepouts ?? [])].sort(byId).map((keepout) => ({
      ...keepout,
      layers: [...keepout.layers].sort(),
    })),
    placementPolicy: board.placementPolicy,
    placementPreferences: board.placementPreferences,
    // B08: dimension annotations are semantic board state. Conditional so
    // every pre-B08 board (no dimensions) keeps its exact revision id —
    // existing stage evidence and head claims stay verifiable.
    ...(board.dimensions?.length ? { dimensions: [...board.dimensions].sort(byId) } : {}),
    netClassing,
    constraintState: board.constraintState ? {
      schemaVersion: board.constraintState.schemaVersion,
      projectId: board.constraintState.projectId,
      documents: board.constraintState.documents,
      activeProgramHash: board.constraintState.activeProgram?.programHash,
      activeProgramDesignRevision: board.constraintState.activeProgram?.designRevision,
      waivers: board.constraintState.waivers,
      legacyMigration: board.constraintState.legacyMigration,
    } : undefined,
  });
}

export function pcbRevisionId(board: PcbBoard): string {
  const payload = canonicalJson(pcbRevisionPayload(board));
  // Two domain-separated lanes materially reduce accidental collisions while
  // retaining a synchronous browser-safe semantic revision key.
  return `pcb2-${stableHash(`sirkit-pcb-v2:a\0${payload}`)}${stableHash(`sirkit-pcb-v2:b\0${payload}`)}`;
}
