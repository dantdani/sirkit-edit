"use client";

/**
 * Arrange section (PCB Stage 17 Phase D) — two compact rows of icon buttons
 * on multi-select inspectors. Thin wrappers over the align/distribute/
 * snap-to-grid commands; the context menu and palette call the same ones.
 * No floating toolbar (deliberate — see the stage notes).
 */

import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Magnet,
} from "lucide-react";
import type { EditCommand, SelectionRef } from "@/app/lib/pcb/edit/commands";
import { mmToNm } from "@/app/lib/pcb/units";

/** Editor placement grid (0.5 mm) — snap-to-grid's default target. */
export const ARRANGE_GRID_NM = mmToNm(0.5);

/** Refs the arrange commands accept (pads move with their footprint). */
export function movableRefs(refs: SelectionRef[]): SelectionRef[] {
  return refs.filter((r) => r.kind !== "pad");
}

export function ArrangeSection({
  refs,
  commit,
}: {
  refs: SelectionRef[];
  commit(cmds: EditCommand[]): void;
}) {
  const movable = movableRefs(refs);
  if (movable.length < 2) return null;

  const btn =
    "p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:hover:bg-transparent";
  const align = (mode: "left" | "right" | "top" | "bottom" | "centerH" | "centerV") =>
    commit([{ op: "align", refs: movable, mode }]);

  return (
    <div className="px-3 py-1.5 border-t border-zinc-800/60">
      <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">Arrange</p>
      <div className="flex items-center gap-1">
        <button type="button" title="Align left" aria-label="Align left" onClick={() => align("left")} className={btn}>
          <AlignStartVertical className="size-3.5" />
        </button>
        <button type="button" title="Align horizontal centers" aria-label="Align horizontal centers" onClick={() => align("centerH")} className={btn}>
          <AlignCenterVertical className="size-3.5" />
        </button>
        <button type="button" title="Align right" aria-label="Align right" onClick={() => align("right")} className={btn}>
          <AlignEndVertical className="size-3.5" />
        </button>
        <span className="w-px h-4 bg-zinc-800 mx-0.5" />
        <button type="button" title="Align top" aria-label="Align top" onClick={() => align("top")} className={btn}>
          <AlignStartHorizontal className="size-3.5" />
        </button>
        <button type="button" title="Align vertical centers" aria-label="Align vertical centers" onClick={() => align("centerV")} className={btn}>
          <AlignCenterHorizontal className="size-3.5" />
        </button>
        <button type="button" title="Align bottom" aria-label="Align bottom" onClick={() => align("bottom")} className={btn}>
          <AlignEndHorizontal className="size-3.5" />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          title={movable.length < 3 ? "Needs at least three items" : "Distribute horizontally"}
          aria-label="Distribute horizontally"
          disabled={movable.length < 3}
          onClick={() => commit([{ op: "distribute", refs: movable, axis: "h" }])}
          className={btn}
        >
          <AlignHorizontalDistributeCenter className="size-3.5" />
        </button>
        <button
          type="button"
          title={movable.length < 3 ? "Needs at least three items" : "Distribute vertically"}
          aria-label="Distribute vertically"
          disabled={movable.length < 3}
          onClick={() => commit([{ op: "distribute", refs: movable, axis: "v" }])}
          className={btn}
        >
          <AlignVerticalDistributeCenter className="size-3.5" />
        </button>
        <span className="w-px h-4 bg-zinc-800 mx-0.5" />
        <button
          type="button"
          title="Snap to 0.5 mm grid"
          aria-label="Snap to grid"
          onClick={() => commit([{ op: "snap-to-grid", refs: movable, gridNm: ARRANGE_GRID_NM }])}
          className={btn}
        >
          <Magnet className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
