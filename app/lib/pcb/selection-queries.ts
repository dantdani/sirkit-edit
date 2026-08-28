/**
 * Selection queries (PCB Stage 17) — pure read-only helpers over
 * (board, SelectionRef[]): resolve refs to items, compute shared field values
 * for multi-select inspectors ('—' when mixed), and expand selections
 * (select-similar, select-net). No store writes here — callers decide.
 */

import type {
  PcbBoard,
  Track,
  Via,
  Zone,
  Pad,
  FootprintInstance,
} from "./types";
import type { SilkTextItem } from "./silk/types";
import type { LayerId } from "./layers";
import type { SelectionRef } from "./edit/commands";

export type ResolvedItem =
  | { kind: "via"; ref: SelectionRef; via: Via }
  | { kind: "track"; ref: SelectionRef; track: Track }
  | { kind: "zone"; ref: SelectionRef; zone: Zone }
  | { kind: "text"; ref: SelectionRef; text: SilkTextItem }
  | { kind: "footprint"; ref: SelectionRef; footprint: FootprintInstance }
  | { kind: "dimension"; ref: SelectionRef; dimension: NonNullable<PcbBoard["dimensions"]>[number] }
  | {
      kind: "pad";
      ref: SelectionRef;
      footprint: FootprintInstance;
      pad: Pad;
      netId: number;
    };

/** Resolve refs to live items; refs that no longer exist are skipped. */
export function getItems(board: PcbBoard, refs: SelectionRef[]): ResolvedItem[] {
  const out: ResolvedItem[] = [];
  for (const ref of refs) {
    switch (ref.kind) {
      case "via": {
        const via = board.vias.find((v) => v.id === ref.id);
        if (via) out.push({ kind: "via", ref, via });
        break;
      }
      case "track": {
        const track = board.tracks.find((t) => t.id === ref.id);
        if (track) out.push({ kind: "track", ref, track });
        break;
      }
      case "zone": {
        const zone = board.zones.find((z) => z.id === ref.id);
        if (zone) out.push({ kind: "zone", ref, zone });
        break;
      }
      case "text": {
        const item = (board.silkItems ?? []).find((s) => s.id === ref.id);
        if (item?.kind === "text") out.push({ kind: "text", ref, text: item });
        break;
      }
      case "footprint": {
        const footprint = board.footprints.find((f) => f.id === ref.id);
        if (footprint) out.push({ kind: "footprint", ref, footprint });
        break;
      }
      case "dimension": {
        const dimension = (board.dimensions ?? []).find((d) => d.id === ref.id);
        if (dimension) out.push({ kind: "dimension", ref, dimension });
        break;
      }
      case "pad": {
        const footprint = board.footprints.find((f) => f.id === ref.footprintId);
        const pad = footprint?.def.pads.find((p) => p.number === ref.padNumber);
        if (footprint && pad) {
          out.push({
            kind: "pad",
            ref,
            footprint,
            pad,
            netId: footprint.padNets[pad.number] ?? 0,
          });
        }
        break;
      }
    }
  }
  return out;
}

// ── Shared-value helpers (multi-select inspector fields) ─────────────────────

/** The one value every item shares, or undefined when mixed / not applicable. */
function shared<T>(values: (T | undefined)[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  if (first === undefined) return undefined;
  return values.every((v) => v === first) ? first : undefined;
}

function itemNetId(item: ResolvedItem): number | undefined {
  switch (item.kind) {
    case "via":
      return item.via.netId;
    case "track":
      return item.track.netId;
    case "zone":
      return item.zone.netId;
    case "pad":
      return item.netId;
    default:
      return undefined; // footprints/text have no single net
  }
}

function itemLayer(item: ResolvedItem): LayerId | undefined {
  switch (item.kind) {
    case "track":
      return item.track.layer;
    case "zone":
      return item.zone.layer;
    case "text":
      return item.text.layer;
    default:
      return undefined; // vias span layers; footprints/pads sit on many
  }
}

export function sharedNetId(board: PcbBoard, refs: SelectionRef[]): number | undefined {
  return shared(getItems(board, refs).map(itemNetId));
}

export function sharedLayer(board: PcbBoard, refs: SelectionRef[]): LayerId | undefined {
  return shared(getItems(board, refs).map(itemLayer));
}

/** Shared via padstack. Pre-migration vias (no padstackId) share nothing. */
export function sharedPadstackId(board: PcbBoard, refs: SelectionRef[]): string | undefined {
  const items = getItems(board, refs);
  if (items.length === 0 || items.some((i) => i.kind !== "via")) return undefined;
  return shared(items.map((i) => (i.kind === "via" ? i.via.padstackId : undefined)));
}

// ── Selection expansion ──────────────────────────────────────────────────────

/** Every copper-carrying item on `netId`: tracks, vias, zones, pads. */
export function selectNet(board: PcbBoard, netId: number): SelectionRef[] {
  const refs: SelectionRef[] = [];
  for (const t of board.tracks) {
    if (t.netId === netId) refs.push({ kind: "track", id: t.id });
  }
  for (const v of board.vias) {
    if (v.netId === netId) refs.push({ kind: "via", id: v.id });
  }
  for (const z of board.zones) {
    if (z.netId === netId) refs.push({ kind: "zone", id: z.id });
  }
  for (const fp of board.footprints) {
    for (const pad of fp.def.pads) {
      if ((fp.padNets[pad.number] ?? 0) === netId && netId !== 0) {
        refs.push({ kind: "pad", footprintId: fp.id, padNumber: pad.number });
      }
    }
  }
  return refs;
}

/**
 * Expand from one item to everything alike:
 * - `net`: same net (tracks/vias/zones/pads).
 * - `layer`: tracks, zones and text on the item's layer.
 * - `padstack`: vias sharing the padstack (or identical size/drill before the
 *   Phase C migration assigns padstack ids).
 */
export function selectSimilar(
  board: PcbBoard,
  ref: SelectionRef,
  by: "net" | "padstack" | "layer",
): SelectionRef[] {
  const [item] = getItems(board, [ref]);
  if (!item) return [];

  if (by === "net") {
    const netId = itemNetId(item);
    // Net 0 = unconnected — every orphan shares it, so "similar" is just this item.
    return netId === undefined || netId === 0 ? [ref] : selectNet(board, netId);
  }

  if (by === "layer") {
    const layer = itemLayer(item);
    if (layer === undefined) return [ref];
    const refs: SelectionRef[] = [];
    for (const t of board.tracks) {
      if (t.layer === layer) refs.push({ kind: "track", id: t.id });
    }
    for (const z of board.zones) {
      if (z.layer === layer) refs.push({ kind: "zone", id: z.id });
    }
    for (const s of board.silkItems ?? []) {
      if (s.kind === "text" && s.layer === layer) refs.push({ kind: "text", id: s.id });
    }
    return refs;
  }

  // by === 'padstack'
  if (item.kind !== "via") return [ref];
  const { padstackId, size, drill } = item.via;
  return board.vias
    .filter((v) =>
      padstackId !== undefined
        ? v.padstackId === padstackId
        : v.padstackId === undefined && v.size === size && v.drill === drill,
    )
    .map((v) => ({ kind: "via", id: v.id }) as SelectionRef);
}
