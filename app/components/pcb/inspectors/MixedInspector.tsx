"use client";

/**
 * Mixed-selection inspector (PCB Stage 17 Phase B) — only fields every item
 * shares: layer (when everything is copper track/zone) and a position delta
 * nudge. Phase D adds the Arrange section here.
 */

import type { PcbBoard } from "@/app/lib/pcb/types";
import type { LayerId } from "@/app/lib/pcb/layers";
import type { EditCommand, SelectionRef } from "@/app/lib/pcb/edit/commands";
import type { ResolvedItem } from "@/app/lib/pcb/selection-queries";
import { NumberField } from "./fields/NumberField";
import { LayerField, copperLayersFor } from "./fields/LayerField";
import { ReadonlyRow } from "./fields/ReadonlyRow";

export function MixedInspector({
  board,
  items,
  commit,
}: {
  board: PcbBoard;
  items: ResolvedItem[];
  commit(cmds: EditCommand[]): void;
}) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const summary = [...counts.entries()]
    .map(([kind, n]) => `${n} ${kind === "footprint" ? "part" : kind}${n === 1 ? "" : "s"}`)
    .join(", ");

  // Layer is editable only when every item is a copper track/zone.
  const copperOnly = items.every((i) => i.kind === "track" || i.kind === "zone");
  const layers = items.flatMap((i): LayerId[] =>
    i.kind === "track" ? [i.track.layer] : i.kind === "zone" ? [i.zone.layer] : [],
  );
  const layerRefs = items.flatMap((i): SelectionRef[] =>
    i.kind === "track" || i.kind === "zone" ? [i.ref] : [],
  );

  // Nudge applies to everything movable (pads move with their footprint;
  // locked footprints are refused by the validator with a toast).
  const movable = items.flatMap((i): SelectionRef[] => (i.kind === "pad" ? [] : [i.ref]));

  const nudge = (dx: number, dy: number): void => {
    if (dx === 0 && dy === 0) return;
    commit([{ op: "move-items", refs: movable, deltaNm: { x: dx, y: dy } }]);
  };

  return (
    <>
      <ReadonlyRow label="Items" value={summary} />
      {copperOnly && (
        <LayerField
          values={layers}
          allowed={copperLayersFor(board.stackup)}
          onCommit={(layer) => commit([{ op: "set-item-layer", refs: layerRefs, layer }])}
        />
      )}
      {movable.length > 0 && (
        <>
          <NumberField
            label="Nudge X"
            unit="mm"
            scaleFromNm={1e-6}
            values={[0]}
            onCommit={(nm) => nudge(nm, 0)}
          />
          <NumberField
            label="Nudge Y"
            unit="mm"
            scaleFromNm={1e-6}
            values={[0]}
            onCommit={(nm) => nudge(0, nm)}
          />
        </>
      )}
    </>
  );
}
