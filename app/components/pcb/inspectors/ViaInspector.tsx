"use client";

/**
 * Via inspector (PCB Stage 17 Phase B). Padstack picker + dims (dims become
 * editable with the Phase C fork rule — until then they read from the via),
 * layers spanned (read-only until buried vias exist), net (read-only,
 * schematic-owned), position (editable, single via).
 */

import type { PcbBoard, Via } from "@/app/lib/pcb/types";
import type { EditCommand } from "@/app/lib/pcb/edit/commands";
import type { EditPreview } from "@/app/lib/pcb/edit/preview";
import { viaSpannedLayers } from "@/app/lib/pcb/geometry-copper";
import { LAYERS } from "@/app/lib/pcb/layers";
import { formatMm } from "@/app/lib/pcb/units";
import { NumberField } from "./fields/NumberField";
import { PadstackField } from "./fields/PadstackField";
import { ReadonlyRow } from "./fields/ReadonlyRow";
import { netLabel, sharedText } from "./shared";

function spannedText(via: Via): string {
  const names = viaSpannedLayers(via).map(
    (id) => LAYERS.find((l) => l.id === id)?.displayName ?? id,
  );
  return names.length > 0 ? `${names[0]} → ${names[names.length - 1]}` : "—";
}

export function ViaInspector({
  board,
  items,
  commit,
  preview,
}: {
  board: PcbBoard;
  items: Via[];
  commit(cmds: EditCommand[]): void;
  preview(cmds: EditCommand[]): EditPreview;
}) {
  const single = items.length === 1 ? items[0] : null;

  return (
    <>
      <PadstackField
        padstacks={[] /* Phase C: board.padstacks via the registry */}
        values={items.map((v) => v.padstackId ?? "")}
        onCommit={() => {}}
      />
      <ReadonlyRow
        label="Size"
        value={sharedText(items.map((v) => `${formatMm(v.size)} mm`))}
        hint="Sizes come from the via's padstack."
      />
      <ReadonlyRow label="Drill" value={sharedText(items.map((v) => `${formatMm(v.drill)} mm`))} />
      <ReadonlyRow
        label="Layers"
        value={sharedText(items.map(spannedText))}
        hint="Through vias only — buried/blind vias are post-MVP."
      />
      <ReadonlyRow label="Net" value={sharedText(items.map((v) => netLabel(board, v.netId)))} />
      {single && (
        <>
          <NumberField
            label="X"
            unit="mm"
            scaleFromNm={1e-6}
            values={[single.at.x]}
            onCommit={(nm) =>
              commit([
                {
                  op: "set-position",
                  ref: { kind: "via", id: single.id },
                  atNm: { x: nm, y: single.at.y },
                },
              ])
            }
            preview={(nm) =>
              preview([
                {
                  op: "set-position",
                  ref: { kind: "via", id: single.id },
                  atNm: { x: nm, y: single.at.y },
                },
              ])
            }
          />
          <NumberField
            label="Y"
            unit="mm"
            scaleFromNm={1e-6}
            values={[single.at.y]}
            onCommit={(nm) =>
              commit([
                {
                  op: "set-position",
                  ref: { kind: "via", id: single.id },
                  atNm: { x: single.at.x, y: nm },
                },
              ])
            }
            preview={(nm) =>
              preview([
                {
                  op: "set-position",
                  ref: { kind: "via", id: single.id },
                  atNm: { x: single.at.x, y: nm },
                },
              ])
            }
          />
        </>
      )}
    </>
  );
}
