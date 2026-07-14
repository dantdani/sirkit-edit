"use client";

/**
 * Track inspector (PCB Stage 17 Phase B). Width (live preview DRC) and layer
 * are editable; net and endpoints are read-only — nets are schematic-owned,
 * and hand-editing segment coordinates would break 45° geometry (deliberate).
 */

import type { PcbBoard, Track } from "@/app/lib/pcb/types";
import type { EditCommand } from "@/app/lib/pcb/edit/commands";
import type { EditPreview } from "@/app/lib/pcb/edit/preview";
import { formatMm } from "@/app/lib/pcb/units";
import { NumberField } from "./fields/NumberField";
import { LayerField, copperLayersFor } from "./fields/LayerField";
import { ReadonlyRow } from "./fields/ReadonlyRow";
import { netLabel, sharedText } from "./shared";

export function TrackInspector({
  board,
  items,
  commit,
  preview,
}: {
  board: PcbBoard;
  items: Track[];
  commit(cmds: EditCommand[]): void;
  preview(cmds: EditCommand[]): EditPreview;
}) {
  const ids = items.map((t) => t.id);
  const refs = ids.map((id) => ({ kind: "track", id }) as const);

  return (
    <>
      <NumberField
        label="Width"
        unit="mm"
        scaleFromNm={1e-6}
        values={items.map((t) => t.width)}
        onCommit={(nm) => commit([{ op: "set-track-width", ids, widthNm: nm }])}
        preview={(nm) => preview([{ op: "set-track-width", ids, widthNm: nm }])}
      />
      <LayerField
        values={items.map((t) => t.layer)}
        allowed={copperLayersFor(board.stackup)}
        onCommit={(layer) => commit([{ op: "set-item-layer", refs: [...refs], layer }])}
      />
      <ReadonlyRow label="Net" value={sharedText(items.map((t) => netLabel(board, t.netId)))} />
      {items.length === 1 && (
        <>
          <ReadonlyRow
            label="Start"
            value={`${formatMm(items[0].start.x)}, ${formatMm(items[0].start.y)} mm`}
          />
          <ReadonlyRow
            label="End"
            value={`${formatMm(items[0].end.x)}, ${formatMm(items[0].end.y)} mm`}
            hint="Endpoints move with routing — the route tool keeps 45° geometry."
          />
        </>
      )}
    </>
  );
}
