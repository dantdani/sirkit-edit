/**
 * Board digest (PCB Stage 17 Phase D) — the compact JSON (≤ ~20 KB) the AI
 * assist endpoint receives instead of the board. Values are in mm for model
 * readability (commands speak integer nm — the endpoint's system prompt
 * carries the conversion rule). Selected items get full props (≤ 50);
 * `buildItemIndex` produces the server-side `query_items` index for boards
 * whose interesting items aren't in the selection.
 */

import type { PcbBoard } from "../types";
import type { NetClassId } from "../netclass";
import { getNetClass } from "../netclass";
import type { DrcPresetId } from "../drc/types";
import { nmToMm } from "../units";
import { usageCount } from "../padstack/registry";
import type { SelectionRef } from "./commands";
import { getItems } from "../selection-queries";

const MAX_SELECTION_DETAIL = 50;

const mm = (nm: number): number => Number(nmToMm(nm).toFixed(4));

export interface DigestNet {
  id: number;
  name: string;
  class: NetClassId;
  tracks: number;
  vias: number;
  /** Track width histogram: mm string → count ("0.25": 12). */
  widthsMm: Record<string, number>;
}

export interface DigestPadstack {
  id: string;
  name: string;
  outerMm: number;
  drillMm: number;
  used: number;
}

export type SelectedItemDetail = Record<string, unknown> & { kind: string };

export interface BoardDigest {
  units: "mm";
  board: { widthMm: number; heightMm: number; stackup: 2 | 4 } | { outline: "polygon"; stackup: 2 | 4 };
  activePreset?: DrcPresetId;
  nets: DigestNet[];
  padstacks: DigestPadstack[];
  counts: { footprints: number; tracks: number; vias: number; zones: number; texts: number };
  selection: {
    count: number;
    kinds: Record<string, number>;
    items: SelectedItemDetail[];
    truncated: boolean;
  };
}

export function buildDigest(
  board: PcbBoard,
  selection: SelectionRef[],
  opts?: { presetId?: DrcPresetId },
): BoardDigest {
  // Nets with per-net track/via counts + width histograms.
  const nets: DigestNet[] = board.nets
    .filter((n) => n.id !== 0)
    .map((n) => {
      const widthsMm: Record<string, number> = {};
      let tracks = 0;
      for (const t of board.tracks) {
        if (t.netId !== n.id) continue;
        tracks++;
        const key = String(mm(t.width));
        widthsMm[key] = (widthsMm[key] ?? 0) + 1;
      }
      const vias = board.vias.filter((v) => v.netId === n.id).length;
      return { id: n.id, name: n.name || `net ${n.id}`, class: getNetClass(board, n.id).id, tracks, vias, widthsMm };
    });

  const padstacks: DigestPadstack[] = (board.padstacks ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    outerMm: mm(p.outerNm),
    drillMm: mm(p.drillNm),
    used: usageCount(board, p.id),
  }));

  const items = getItems(board, selection);
  const kinds: Record<string, number> = {};
  for (const item of items) kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;

  const netName = (netId: number): string =>
    board.nets.find((n) => n.id === netId)?.name || `net ${netId}`;

  const detail: SelectedItemDetail[] = items.slice(0, MAX_SELECTION_DETAIL).map((item) => {
    switch (item.kind) {
      case "track":
        return {
          kind: "track",
          id: item.track.id,
          net: netName(item.track.netId),
          netId: item.track.netId,
          layer: item.track.layer,
          widthMm: mm(item.track.width),
          fromMm: [mm(item.track.start.x), mm(item.track.start.y)],
          toMm: [mm(item.track.end.x), mm(item.track.end.y)],
        };
      case "via":
        return {
          kind: "via",
          id: item.via.id,
          net: netName(item.via.netId),
          netId: item.via.netId,
          padstackId: item.via.padstackId,
          outerMm: mm(item.via.size),
          drillMm: mm(item.via.drill),
          atMm: [mm(item.via.at.x), mm(item.via.at.y)],
        };
      case "footprint":
        return {
          kind: "footprint",
          id: item.footprint.id,
          ref: item.footprint.ref,
          footprint: item.footprint.footprintId,
          atMm: [mm(item.footprint.at.x), mm(item.footprint.at.y)],
          rotationDeg: item.footprint.rotationDeg,
          side: item.footprint.side,
          locked: item.footprint.locked ?? false,
        };
      case "zone":
        return {
          kind: "zone",
          id: item.zone.id,
          net: netName(item.zone.netId),
          netId: item.zone.netId,
          layer: item.zone.layer,
          connect: item.zone.connection,
          clearanceMm:
            item.zone.clearanceOverrideNm !== undefined ? mm(item.zone.clearanceOverrideNm) : undefined,
        };
      case "text":
        return {
          kind: "text",
          id: item.text.id,
          text: item.text.text,
          layer: item.text.layer,
          sizeMm: mm(item.text.heightNm),
          strokeMm: mm(item.text.strokeWidthNm),
          atMm: [mm(item.text.position.x), mm(item.text.position.y)],
        };
      case "pad":
        return {
          kind: "pad",
          footprintId: item.footprint.id,
          ref: item.footprint.ref,
          padNumber: item.pad.number,
          net: netName(item.netId),
        };
    }
  });

  const base = { stackup: board.stackup } as const;
  const boardInfo =
    board.outline.kind === "polygon"
      ? ({ outline: "polygon", ...base } as const)
      : ({ widthMm: mm(board.outline.width), heightMm: mm(board.outline.height), ...base } as const);

  return {
    units: "mm",
    board: boardInfo,
    ...(opts?.presetId ? { activePreset: opts.presetId } : {}),
    nets,
    padstacks,
    counts: {
      footprints: board.footprints.length,
      tracks: board.tracks.length,
      vias: board.vias.length,
      zones: board.zones.length,
      texts: (board.silkItems ?? []).filter((s) => s.kind === "text").length,
    },
    selection: {
      count: items.length,
      kinds,
      items: detail,
      truncated: items.length > MAX_SELECTION_DETAIL,
    },
  };
}

/** One row per selectable item — the server-side `query_items` index for
 *  boards whose relevant items aren't in the digest's selection detail.
 *  Pads are omitted (net membership is answerable from the net table). */
export interface CompactItem {
  kind: "track" | "via" | "zone" | "text" | "footprint";
  id: string;
  ref?: string;
  net?: string;
  layer?: string;
  widthMm?: number;
  xMm: number;
  yMm: number;
}

export function buildItemIndex(board: PcbBoard): CompactItem[] {
  const netName = (netId: number): string =>
    board.nets.find((n) => n.id === netId)?.name || `net ${netId}`;
  const out: CompactItem[] = [];
  for (const f of board.footprints) {
    out.push({ kind: "footprint", id: f.id, ref: f.ref, xMm: mm(f.at.x), yMm: mm(f.at.y) });
  }
  for (const t of board.tracks) {
    out.push({
      kind: "track",
      id: t.id,
      net: netName(t.netId),
      layer: t.layer,
      widthMm: mm(t.width),
      xMm: mm((t.start.x + t.end.x) / 2),
      yMm: mm((t.start.y + t.end.y) / 2),
    });
  }
  for (const v of board.vias) {
    out.push({ kind: "via", id: v.id, net: netName(v.netId), xMm: mm(v.at.x), yMm: mm(v.at.y) });
  }
  for (const z of board.zones) {
    const p = z.polygon[0] ?? { x: 0, y: 0 };
    out.push({ kind: "zone", id: z.id, net: netName(z.netId), layer: z.layer, xMm: mm(p.x), yMm: mm(p.y) });
  }
  for (const s of board.silkItems ?? []) {
    if (s.kind !== "text") continue;
    out.push({ kind: "text", id: s.id, layer: s.layer, xMm: mm(s.position.x), yMm: mm(s.position.y) });
  }
  return out;
}
