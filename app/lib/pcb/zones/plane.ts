/**
 * 4-layer plane helper (PCB Stage 11). A "GND plane on Inner 1" is nothing
 * but a zone whose polygon is the board outline — no separate model. The
 * caller dispatches the result through an `AddZone` command; `useZoneFills`
 * pours it on the next tick (`dirty: true`).
 */

import type { PcbBoard, Zone } from "../types";
import type { LayerId } from "../layers";
import { COPPER_LAYERS } from "../layers";
import { outlinePolygon } from "./geometry";
import { resolveNetIdentity } from "../copper-policy";
import { markZoneFillDirty } from "./fill-lifecycle";

let planeSeq = 0;
const planeSalt = Math.random().toString(36).slice(2, 8);

/** Copper layer only ("copperTop" | "in1" | "in2" | "copperBottom"). */
export function makePlaneZone(
  board: PcbBoard,
  layer: LayerId,
  netId: number,
  options?: {
    appearance?: "solid" | "hatched";
    connection?: "solid" | "thermal";
    id?: string;
  },
): Zone {
  if (!COPPER_LAYERS.includes(layer)) {
    throw new Error(`makePlaneZone: ${layer} is not a copper layer`);
  }
  planeSeq += 1;
  return {
    id: options?.id ?? `zone-plane-${planeSalt}-${planeSeq}`,
    layer,
    netId,
    source: "user",
    priority: 0,
    polygon: outlinePolygon(board.outline),
    appearance: options?.appearance ?? "solid",
    connection: options?.connection ?? "thermal",
    fill: [],
    dirty: true,
  };
}

export const STACKUP_PLANE_ZONE_PREFIX = "sirkit:stackup-plane:";
export const STACKUP_PLANE_PRIORITY = -1000;

export function stackupPlaneZoneId(layer: LayerId): string {
  return `${STACKUP_PLANE_ZONE_PREFIX}${layer}`;
}

export interface PlaneReconciliationReport {
  created: string[];
  updated: string[];
  removed: string[];
  unresolved: Array<{ layer: LayerId; netId?: number; reason: string }>;
}

/**
 * Materialize stackup intent as exactly one native zone per assigned plane.
 * This is a model transaction helper: callers put it in the same history
 * operation as the stackup edit. It never computes derived fill copper.
 */
export function reconcileStackupPlaneZones(board: PcbBoard): PlaneReconciliationReport {
  const report: PlaneReconciliationReport = { created: [], updated: [], removed: [], unresolved: [] };
  const desired = new Map<LayerId, number>();
  for (const layer of board.stackupConfig?.copperLayers ?? []) {
    if (!layer.enabled || layer.role !== "plane") continue;
    if (layer.planeNetId === undefined) {
      continue;
    }
    const identity = resolveNetIdentity(board, layer.planeNetId);
    if (identity.state !== "proven") {
      report.unresolved.push({ layer: layer.id, netId: layer.planeNetId, reason: identity.reason ?? "Plane net is not proven." });
      continue;
    }
    desired.set(layer.id, layer.planeNetId);
  }

  const generated = board.zones.filter((zone) => zone.source === "stackup-plane");
  for (const zone of generated) {
    const sourceLayer = zone.sourceLayerId ?? zone.layer;
    const expectedId = stackupPlaneZoneId(sourceLayer);
    if (!desired.has(sourceLayer) || zone.id !== expectedId) {
      report.removed.push(zone.id);
    }
  }
  if (report.removed.length > 0) {
    const removed = new Set(report.removed);
    board.zones = board.zones.filter((zone) => !removed.has(zone.id));
  }

  const polygon = outlinePolygon(board.outline);
  for (const [layer, netId] of desired) {
    const id = stackupPlaneZoneId(layer);
    const existing = board.zones.find((zone) => zone.id === id);
    if (existing && existing.source !== "stackup-plane") {
      report.unresolved.push({ layer, netId, reason: `Native object id ${id} is occupied by a user zone.` });
      continue;
    }
    if (!existing) {
      const zone: Zone = {
        id,
        layer,
        netId,
        source: "stackup-plane",
        sourceLayerId: layer,
        priority: STACKUP_PLANE_PRIORITY,
        locked: true,
        polygon: structuredClone(polygon),
        appearance: "solid",
        connection: "thermal",
        fill: [],
        dirty: true,
      };
      markZoneFillDirty(zone);
      board.zones.push(zone);
      report.created.push(id);
      continue;
    }
    const geometryChanged = JSON.stringify(existing.polygon) !== JSON.stringify(polygon);
    const changed = existing.layer !== layer
      || existing.netId !== netId
      || existing.sourceLayerId !== layer
      || existing.priority !== STACKUP_PLANE_PRIORITY
      || existing.locked !== true
      || geometryChanged;
    existing.layer = layer;
    existing.netId = netId;
    existing.sourceLayerId = layer;
    existing.priority = STACKUP_PLANE_PRIORITY;
    existing.locked = true;
    existing.polygon = structuredClone(polygon);
    if (changed) {
      markZoneFillDirty(existing);
      report.updated.push(id);
    }
  }
  board.zones.sort((a, b) => a.id.localeCompare(b.id));
  return report;
}
