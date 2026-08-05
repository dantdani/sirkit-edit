import type { PcbBoard } from "../types";
import { shapeBBox } from "../geometry";
import { COPPER_LAYERS, type LayerId } from "../layers";
import {
  padCopperLayers,
  padWorldShape,
  trackShape,
  viaShape,
  viaSpannedLayers,
} from "../geometry-copper";
import { polygonBBox } from "../zones/geometry";
import { stableHash } from "./hash";
import { RoutingSpatialIndex } from "./spatial-index";
import { SMART_ROUTING_SCHEMA_VERSION, type RoutingWorld, type RoutingWorldItem } from "./types";
import { zoneFillIsCurrent } from "../zones/fill-lifecycle";

function copperLayersFor(board: PcbBoard): readonly LayerId[] {
  return board.stackup === 2 ? ["copperTop", "copperBottom"] : COPPER_LAYERS;
}

function semanticRevision(board: PcbBoard): string {
  // Hash full routing semantics rather than only bounding boxes. A diagonal
  // flipped inside the same box, a changed polygon, or a different drill must
  // invalidate preview/replay even when its broad-phase extent is unchanged.
  const payload = {
    stackup: board.stackup,
    outline: board.outline,
    pads: board.footprints
      .flatMap((instance) => instance.def.pads.map((pad) => ({
        key: `${instance.id}.${pad.number}`,
        at: instance.at,
        rotationDeg: instance.rotationDeg,
        side: instance.side,
        netId: pad.type === "np_thru_hole" ? 0 : (instance.padNets[pad.number] ?? 0),
        pad: {
          type: pad.type,
          shape: pad.shape,
          at: pad.at,
          rotationDeg: pad.rotationDeg,
          layers: pad.layers,
          drill: pad.drill,
        },
      })))
      .sort((a, b) => a.key.localeCompare(b.key)),
    tracks: board.tracks
      .map((track) => ({
        id: track.id,
        layer: track.layer,
        width: track.width,
        start: track.start,
        end: track.end,
        netId: track.netId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    vias: board.vias
      .map((via) => ({
        id: via.id,
        at: via.at,
        size: via.size,
        drill: via.drill,
        netId: via.netId,
        layers: via.layers,
        padstackId: via.padstackId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    zones: board.zones
      .map((zone) => ({ id: zone.id, layer: zone.layer, netId: zone.netId, fill: zone.fill }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    keepouts: [...(board.routingKeepouts ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return `rw1-${stableHash(JSON.stringify(payload))}`;
}

/** Build one immutable, layer-aware routing snapshot from the canonical board. */
export function adaptBoardToRoutingWorld(board: PcbBoard): RoutingWorld {
  const items: RoutingWorldItem[] = [];
  const allCopper = copperLayersFor(board);

  for (const instance of board.footprints) {
    for (const pad of instance.def.pads) {
      const key = `${instance.id}.${pad.number}`;
      const isHole = pad.type === "np_thru_hole";
      const layers = isHole ? allCopper : padCopperLayers(instance, pad);
      if (!layers.length) continue;
      items.push({
        id: `${isHole ? "hole" : "pad"}:${key}`,
        kind: isHole ? "hole" : "pad",
        netId: isHole ? 0 : (instance.padNets[pad.number] ?? 0),
        layers: Object.freeze([...layers]),
        bbox: Object.freeze(shapeBBox(padWorldShape(instance, pad))),
        ...(isHole ? {} : { sourceRef: { kind: "pad" as const, instanceId: instance.id, padNumber: pad.number } }),
      });
    }
  }
  for (const track of board.tracks) {
    items.push({
      id: `track:${track.id}`,
      kind: "track",
      netId: track.netId,
      layers: Object.freeze([track.layer]),
      bbox: Object.freeze(shapeBBox(trackShape(track))),
      sourceRef: { kind: "track", id: track.id },
    });
  }
  for (const via of board.vias) {
    items.push({
      id: `via:${via.id}`,
      kind: "via",
      netId: via.netId,
      layers: Object.freeze([...viaSpannedLayers(via)]),
      bbox: Object.freeze(shapeBBox(viaShape(via))),
      sourceRef: { kind: "via", id: via.id },
    });
  }
  for (const zone of board.zones) {
    if (!zoneFillIsCurrent(board, zone)) continue;
    zone.fill.forEach((region, index) => {
      items.push({
        id: `zone:${zone.id}#${index}`,
        kind: "zone",
        netId: zone.netId,
        layers: Object.freeze([zone.layer]),
        bbox: Object.freeze({ ...region.boundingBox }),
        sourceRef: { kind: "zone-region", zoneId: zone.id, regionIndex: index },
      });
    });
  }
  for (const keepout of board.routingKeepouts ?? []) {
    if (!keepout.forbidTracks || keepout.polygon.length < 3) continue;
    items.push({
      id: `keepout:${keepout.id}`,
      kind: "keepout",
      netId: 0,
      layers: Object.freeze([...keepout.layers]),
      bbox: Object.freeze(polygonBBox(keepout.polygon)),
    });
  }

  items.sort((a, b) => a.id.localeCompare(b.id));
  const frozenItems = Object.freeze(items);
  return {
    schemaVersion: SMART_ROUTING_SCHEMA_VERSION,
    revision: semanticRevision(board),
    board,
    items: frozenItems,
    spatial: new RoutingSpatialIndex(frozenItems),
  };
}

export function routingWorldRevision(board: PcbBoard): string {
  return adaptBoardToRoutingWorld(board).revision;
}
