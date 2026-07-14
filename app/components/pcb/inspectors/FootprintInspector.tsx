"use client";

/**
 * Footprint inspector (PCB Stage 17 Phase B). Ref/footprint are read-only
 * (schematic-owned); position (single), rotation, side and the locked toggle
 * are editable — all through edit commands, one undo step each. Locked parts
 * refuse move/rotate at the validator, so those commits surface a toast.
 */

import type { PcbBoard, FootprintInstance } from "@/app/lib/pcb/types";
import type { EditCommand } from "@/app/lib/pcb/edit/commands";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { BooleanField } from "./fields/BooleanField";
import { ReadonlyRow } from "./fields/ReadonlyRow";
import { sharedText } from "./shared";

export function FootprintInspector({
  items,
  commit,
}: {
  board: PcbBoard;
  items: FootprintInstance[];
  commit(cmds: EditCommand[]): void;
}) {
  const single = items.length === 1 ? items[0] : null;

  return (
    <>
      <ReadonlyRow label="Ref" value={sharedText(items.map((f) => f.ref))} />
      {single && (
        <ReadonlyRow
          label="Footprint"
          value={single.footprintId}
          hint="Assigned in the schematic — re-sync to change."
        />
      )}
      {single && !single.locked && (
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
                  ref: { kind: "footprint", id: single.id },
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
                  ref: { kind: "footprint", id: single.id },
                  atNm: { x: single.at.x, y: nm },
                },
              ])
            }
          />
        </>
      )}
      <NumberField
        label="Rotation"
        unit="°"
        scaleFromNm={1}
        values={items.map((f) => f.rotationDeg)}
        disabled={items.some((f) => f.locked)}
        onCommit={(deg) =>
          commit(
            items.map((f) => ({
              op: "set-footprint-props" as const,
              id: f.id,
              patch: { rotationDeg: deg },
            })),
          )
        }
      />
      <SelectField
        label="Side"
        values={items.map((f) => f.side)}
        options={[
          { value: "top", label: "Top" },
          { value: "bottom", label: "Bottom" },
        ]}
        disabled={items.some((f) => f.locked)}
        onCommit={(side) =>
          commit(
            items.map((f) => ({
              op: "set-footprint-props" as const,
              id: f.id,
              patch: { side: side as "top" | "bottom" },
            })),
          )
        }
      />
      <BooleanField
        label="Locked"
        values={items.map((f) => f.locked ?? false)}
        onCommit={(locked) =>
          commit(
            items.map((f) => ({
              op: "set-footprint-props" as const,
              id: f.id,
              patch: { locked },
            })),
          )
        }
      />
    </>
  );
}
