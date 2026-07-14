"use client";

/**
 * Via inspector (PCB Stage 17). Padstack picker + dims with the Phase C fork
 * rule: dimension edits are LOCAL by default — they fork a padstack named
 * `Custom for <via>` (create + retarget in ONE undo step) — with an inline
 * unchecked checkbox "Also update N other vias using '<name>'" that switches
 * the commit to a global `edit-padstack` instead. Layers spanned and net are
 * read-only (through vias only; nets are schematic-owned). Position is
 * editable for a single via.
 */

import { useEffect, useState } from "react";
import type { PcbBoard, Via } from "@/app/lib/pcb/types";
import type { EditCommand } from "@/app/lib/pcb/edit/commands";
import type { EditPreview } from "@/app/lib/pcb/edit/preview";
import type { PadstackInput } from "@/app/lib/pcb/padstack/types";
import {
  getPadstack,
  usageCount,
  nextPadstackId,
  resolveVia,
} from "@/app/lib/pcb/padstack/registry";
import { viaSpannedLayers } from "@/app/lib/pcb/geometry-copper";
import { LAYERS } from "@/app/lib/pcb/layers";
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
  const ids = items.map((v) => v.id);
  const padstacks = board.padstacks ?? [];

  // The one padstack every selected via uses, if any.
  const sharedPsId =
    items.length > 0 &&
    items[0].padstackId !== undefined &&
    items.every((v) => v.padstackId === items[0].padstackId)
      ? items[0].padstackId
      : undefined;
  const sharedPs = sharedPsId !== undefined ? getPadstack(board, sharedPsId) : undefined;
  const otherCount = sharedPs ? usageCount(board, sharedPs.id) - items.length : 0;

  // Fork rule: local by default; the checkbox opts into the global edit.
  const [updateOthers, setUpdateOthers] = useState(false);
  const selectionKey = ids.join(",");
  useEffect(() => setUpdateOthers(false), [selectionKey]);

  /** Commands for a dim edit — global edit-padstack, or fork + retarget. */
  const dimCmds = (patch: { outerNm?: number; drillNm?: number }): EditCommand[] => {
    if (sharedPs && (updateOthers || otherCount === 0)) {
      // Global edit (also when nothing else uses it — editing IS local then).
      return [{ op: "edit-padstack", id: sharedPs.id, patch }];
    }
    const base: PadstackInput = sharedPs
      ? { ...sharedPs }
      : {
          name: "",
          kind: "via",
          outerNm: items[0].size,
          drillNm: items[0].drill,
          tented: resolveVia(board, items[0]).tented,
          zoneConnect: resolveVia(board, items[0]).zoneConnect,
        };
    const custom: PadstackInput = {
      ...base,
      ...patch,
      name: `Custom for ${items[0].id}${items.length > 1 ? ` +${items.length - 1}` : ""}`,
    };
    return [
      { op: "create-padstack", padstack: custom },
      { op: "set-via-padstack", viaIds: ids, padstackId: nextPadstackId(board) },
    ];
  };

  return (
    <>
      <PadstackField
        padstacks={padstacks}
        values={items.map((v) => v.padstackId ?? "")}
        onCommit={(padstackId) => commit([{ op: "set-via-padstack", viaIds: ids, padstackId }])}
      />
      <NumberField
        label="Size"
        unit="mm"
        scaleFromNm={1e-6}
        values={items.map((v) => v.size)}
        onCommit={(nm) => commit(dimCmds({ outerNm: nm }))}
        preview={(nm) => preview(dimCmds({ outerNm: nm }))}
      />
      <NumberField
        label="Drill"
        unit="mm"
        scaleFromNm={1e-6}
        values={items.map((v) => v.drill)}
        onCommit={(nm) => commit(dimCmds({ drillNm: nm }))}
        preview={(nm) => preview(dimCmds({ drillNm: nm }))}
      />
      {sharedPs && otherCount > 0 && (
        <label className="px-3 py-1 flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            aria-label="Also update other vias"
            checked={updateOthers}
            onChange={(e) => setUpdateOthers(e.target.checked)}
            className="mt-0.5 size-3.5 accent-teal-600 shrink-0"
          />
          <span className="text-[11px] leading-snug text-zinc-400">
            Also update {otherCount} other via{otherCount === 1 ? "" : "s"} using
            &lsquo;{sharedPs.name}&rsquo;
          </span>
        </label>
      )}
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
