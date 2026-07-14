"use client";

/**
 * Zone inspector (PCB Stage 17 Phase B). Zones are the one board-side net
 * picker by design (planes get retargeted); connection style and clearance
 * override are editable; Refill recomputes derived fills (never an undo
 * entry — Stage 11 semantics).
 */

import { RefreshCw } from "lucide-react";
import type { PcbBoard, Zone } from "@/app/lib/pcb/types";
import type { EditCommand } from "@/app/lib/pcb/edit/commands";
import { getNetClass } from "@/app/lib/pcb/netclass";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { netLabel } from "./shared";

export function ZoneInspector({
  board,
  items,
  commit,
  onRefill,
}: {
  board: PcbBoard;
  items: Zone[];
  commit(cmds: EditCommand[]): void;
  onRefill?(): void;
}) {
  return (
    <>
      <SelectField
        label="Net"
        values={items.map((z) => String(z.netId))}
        options={board.nets
          .filter((n) => n.id !== 0)
          .map((n) => ({ value: String(n.id), label: netLabel(board, n.id) }))}
        onCommit={(v) =>
          commit(
            items.map((z) => ({
              op: "set-zone-props" as const,
              id: z.id,
              patch: { netId: Number(v) },
            })),
          )
        }
      />
      <SelectField
        label="Connect"
        values={items.map((z) => z.connection)}
        options={[
          { value: "thermal", label: "Thermal relief" },
          { value: "solid", label: "Solid" },
        ]}
        onCommit={(v) =>
          commit(
            items.map((z) => ({
              op: "set-zone-props" as const,
              id: z.id,
              patch: { connect: v as "thermal" | "solid" },
            })),
          )
        }
      />
      <NumberField
        label="Clearance"
        unit="mm"
        scaleFromNm={1e-6}
        values={items.map((z) => z.clearanceOverrideNm ?? getNetClass(board, z.netId).clearance)}
        onCommit={(nm) =>
          commit(
            items.map((z) => ({
              op: "set-zone-props" as const,
              id: z.id,
              patch: { clearanceNm: nm },
            })),
          )
        }
      />
      {onRefill && (
        <div className="px-3 py-1.5">
          <button
            type="button"
            onClick={onRefill}
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className="size-3" />
            Refill
          </button>
        </div>
      )}
    </>
  );
}
