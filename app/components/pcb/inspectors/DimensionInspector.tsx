"use client";

/**
 * B08 — dimension-annotation inspector. Edits commit ONE canonical
 * transaction each through the PCB commit gateway (pcb.dimension): the
 * measured value is derived and read-only; kind, layer, unit, precision,
 * offset, text height, and stroke are editable.
 */

import { produce } from "immer";
import { commitPcbCandidate } from "@/app/lib/engineering/pcb-commit-gateway";
import type { PcbHistory } from "@/app/lib/pcb/history";
import { DIMENSION_LAYERS, type BoardDimension, type DimensionKind, type DimensionLayer } from "@/app/lib/pcb/types";
import { formatDimensionValue } from "@/app/lib/pcb/dimensions/geometry";
import { mutateBoardWithDimensionCommand, type DimensionPatch } from "@/app/lib/pcb/dimensions/commands";
import { NM_PER_MM } from "@/app/lib/pcb/units";

const mm = (nm: number): number => nm / NM_PER_MM;
const nm = (value: number): number => Math.round(value * NM_PER_MM);

export function DimensionInspector({
  items,
  getHistory,
  toast,
}: {
  items: BoardDimension[];
  getHistory: () => PcbHistory | null;
  toast(message: string): void;
}) {
  const item = items[0];
  if (!item || items.length !== 1) {
    return <div className="px-3 py-2 text-xs text-zinc-500">{items.length} dimensions selected — edit one at a time.</div>;
  }

  const update = (patch: DimensionPatch, label: string): void => {
    const h = getHistory();
    if (!h) return;
    void commitPcbCandidate(h, {
      commandId: "pcb.dimension",
      label,
      // [B18-C I7] the shared pure command — the agent's granted dimension update uses the same one.
      buildCandidate: (board) => produce(board, (draft) => {
        mutateBoardWithDimensionCommand(draft, { kind: "EditDimension", id: item.id, patch });
      }),
    }).then((result) => { if (!result.ok) toast(result.message); });
  };

  return (
    <div className="px-3 py-2 space-y-2 text-xs">
      <div className="text-zinc-400">Measured: <span className="text-zinc-200 font-mono">{formatDimensionValue(item)}</span> <span className="text-zinc-600">(derived — never stale)</span></div>
      <label className="flex items-center justify-between gap-2">Kind
        <select className="bg-zinc-800 rounded px-1 py-0.5" value={item.kind} onChange={(e) => update({ kind: e.target.value as DimensionKind }, "Change dimension kind")}>
          <option value="horizontal">horizontal</option>
          <option value="vertical">vertical</option>
          <option value="aligned">aligned</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">Layer
        <select className="bg-zinc-800 rounded px-1 py-0.5" value={item.layer} onChange={(e) => update({ layer: e.target.value as DimensionLayer }, "Change dimension layer")}>
          {DIMENSION_LAYERS.map((layer) => <option key={layer} value={layer}>{layer}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">Unit
        <select className="bg-zinc-800 rounded px-1 py-0.5" value={item.unit} onChange={(e) => update({ unit: e.target.value as "mm" | "in" }, "Change dimension unit")}>
          <option value="mm">mm</option>
          <option value="in">in</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">Precision
        <select className="bg-zinc-800 rounded px-1 py-0.5" value={item.precision} onChange={(e) => update({ precision: Number(e.target.value) as BoardDimension["precision"] }, "Change dimension precision")}>
          {[0, 1, 2, 3, 4].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">Offset (mm)
        <input type="number" step="0.5" className="bg-zinc-800 rounded px-1 py-0.5 w-20" defaultValue={mm(item.offsetNm)} key={`${item.id}:${item.offsetNm}`}
          onBlur={(e) => { const v = nm(Number(e.target.value)); if (Number.isSafeInteger(v) && v !== item.offsetNm) update({ offsetNm: v }, "Change dimension offset"); }} />
      </label>
      <label className="flex items-center justify-between gap-2">Text height (mm)
        <input type="number" step="0.1" min="0.1" className="bg-zinc-800 rounded px-1 py-0.5 w-20" defaultValue={mm(item.textHeightNm)} key={`${item.id}:${item.textHeightNm}`}
          onBlur={(e) => { const v = nm(Number(e.target.value)); if (Number.isSafeInteger(v) && v > 0 && v !== item.textHeightNm) update({ textHeightNm: v }, "Change dimension text height"); }} />
      </label>
    </div>
  );
}
