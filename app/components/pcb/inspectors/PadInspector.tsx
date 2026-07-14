"use client";

/**
 * Pad inspector (PCB Stage 17 Phase B) — read-only by design. Pad geometry is
 * owned by `FootprintDef.rawSexpr` (Stage 1/13 verbatim re-emission
 * invariant); the net comes from the schematic via `padNets`. Editing happens
 * in the schematic, never here.
 */

import type { Pad, PcbBoard, FootprintInstance } from "@/app/lib/pcb/types";
import { formatMm } from "@/app/lib/pcb/units";
import { LAYERS } from "@/app/lib/pcb/layers";
import { ReadonlyRow } from "./fields/ReadonlyRow";
import { netLabel, sharedText } from "./shared";

export interface PadItem {
  footprint: FootprintInstance;
  pad: Pad;
  netId: number;
}

function shapeText(pad: Pad): string {
  const s = pad.shape;
  switch (s.kind) {
    case "circle":
      return `circle Ø${formatMm(s.radius * 2)} mm`;
    case "rect":
    case "roundrect":
    case "oval":
      return `${s.kind} ${formatMm(s.width)} × ${formatMm(s.height)} mm`;
    case "polygon":
      return `polygon (${s.points.length} pts)`;
  }
}

function layersText(pad: Pad): string {
  const copper = pad.layers.filter((l) => LAYERS.find((d) => d.id === l)?.kind === "copper");
  return copper.map((l) => LAYERS.find((d) => d.id === l)?.displayName ?? l).join(", ") || "—";
}

export function PadInspector({ board, items }: { board: PcbBoard; items: PadItem[] }) {
  return (
    <>
      <ReadonlyRow
        label="Pad"
        value={sharedText(items.map((i) => `${i.footprint.ref} · pad ${i.pad.number || "NPTH"}`))}
      />
      <ReadonlyRow label="Type" value={sharedText(items.map((i) => i.pad.type))} />
      <ReadonlyRow label="Shape" value={sharedText(items.map((i) => shapeText(i.pad)))} />
      <ReadonlyRow label="Layers" value={sharedText(items.map((i) => layersText(i.pad)))} />
      <ReadonlyRow label="Net" value={sharedText(items.map((i) => netLabel(board, i.netId)))} />
      <p className="px-3 py-2 text-[10px] leading-snug text-zinc-600 border-t border-zinc-800/60">
        Pad geometry is footprint-owned. To change it, edit the footprint from
        the schematic and re-sync.
      </p>
    </>
  );
}
