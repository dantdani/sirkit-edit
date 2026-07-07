"use client";

/**
 * PCB canvas toolbar (PCB Stage 3): select/pan tool toggle, zoom-to-fit,
 * grid on/off, stackup 2/4 switch (proves layer-panel filtering), and board
 * outline controls (size presets, roundrect toggle, numeric width/height mm).
 */

import { Hand, LayoutGrid, Maximize2, MousePointer } from "lucide-react";
import type { BoardOutline } from "@/app/lib/pcb/types";
import { mmToNm, nmToMm } from "@/app/lib/pcb/units";

const MIN_BOARD_MM = 10;
const ROUNDRECT_RADIUS_MM = 2;

const PRESETS = [
  { label: "50×50", w: 50, h: 50 },
  { label: "80×60", w: 80, h: 60 },
  { label: "100×80", w: 100, h: 80 },
] as const;

function iconButtonClass(active: boolean): string {
  return `p-1.5 rounded transition-colors ${
    active
      ? "bg-teal-500/15 text-teal-400"
      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
  }`;
}

export function PcbToolbar({
  tool,
  onToolChange,
  onZoomToFit,
  gridOn,
  onToggleGrid,
  stackup,
  onStackupChange,
  outline,
  onOutlineChange,
  children,
}: {
  tool: "select" | "pan";
  onToolChange: (tool: "select" | "pan") => void;
  onZoomToFit: () => void;
  gridOn: boolean;
  onToggleGrid: () => void;
  stackup: 2 | 4;
  onStackupChange: (stackup: 2 | 4) => void;
  outline: BoardOutline;
  onOutlineChange: (outline: BoardOutline) => void;
  /** Right-aligned extras (Stage 4 mounts Sync + queue here). */
  children?: React.ReactNode;
}) {
  const isRectLike = outline.kind === "rect" || outline.kind === "roundrect";
  const widthMm = isRectLike ? nmToMm(outline.width) : 0;
  const heightMm = isRectLike ? nmToMm(outline.height) : 0;

  const applyPreset = (w: number, h: number): void => {
    const origin = isRectLike ? outline.origin : { x: 0, y: 0 };
    if (outline.kind === "roundrect") {
      onOutlineChange({ ...outline, origin, width: mmToNm(w), height: mmToNm(h) });
    } else {
      onOutlineChange({ kind: "rect", origin, width: mmToNm(w), height: mmToNm(h) });
    }
  };

  const applySize = (dim: "width" | "height", raw: string): void => {
    if (!isRectLike) return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    onOutlineChange({ ...outline, [dim]: mmToNm(Math.max(v, MIN_BOARD_MM)) });
  };

  const toggleRoundRect = (): void => {
    if (outline.kind === "rect") {
      onOutlineChange({ ...outline, kind: "roundrect", cornerRadius: mmToNm(ROUNDRECT_RADIUS_MM) });
    } else if (outline.kind === "roundrect") {
      onOutlineChange({
        kind: "rect",
        origin: outline.origin,
        width: outline.width,
        height: outline.height,
      });
    }
  };

  return (
    <div className="flex items-center gap-1 px-2 h-9 shrink-0 border-b border-zinc-800 bg-zinc-900/50 text-xs select-none">
      <button
        type="button"
        title="Select"
        aria-label="Select tool"
        onClick={() => onToolChange("select")}
        className={iconButtonClass(tool === "select")}
      >
        <MousePointer className="size-3.5" />
      </button>
      <button
        type="button"
        title="Pan"
        aria-label="Pan tool"
        onClick={() => onToolChange("pan")}
        className={iconButtonClass(tool === "pan")}
      >
        <Hand className="size-3.5" />
      </button>

      <div className="w-px h-4 bg-zinc-800 mx-1" />

      <button
        type="button"
        title="Zoom to fit"
        aria-label="Zoom to fit"
        onClick={onZoomToFit}
        className={iconButtonClass(false)}
      >
        <Maximize2 className="size-3.5" />
      </button>
      <button
        type="button"
        title="Toggle grid"
        aria-label="Toggle grid"
        onClick={onToggleGrid}
        className={iconButtonClass(gridOn)}
      >
        <LayoutGrid className="size-3.5" />
      </button>

      <div className="w-px h-4 bg-zinc-800 mx-1" />

      <span className="text-zinc-500">Stackup</span>
      <select
        aria-label="Stackup"
        value={stackup}
        onChange={(e) => onStackupChange(Number(e.target.value) === 4 ? 4 : 2)}
        className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-300 focus:outline-none focus:border-teal-600"
      >
        <option value={2}>2-layer</option>
        <option value={4}>4-layer</option>
      </select>

      <div className="w-px h-4 bg-zinc-800 mx-1" />

      <span className="text-zinc-500">Outline</span>
      {PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => applyPreset(p.w, p.h)}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            isRectLike && widthMm === p.w && heightMm === p.h
              ? "bg-teal-500/15 text-teal-400"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        title="Rounded corners (2 mm)"
        onClick={toggleRoundRect}
        disabled={!isRectLike}
        className={`px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 ${
          outline.kind === "roundrect"
            ? "bg-teal-500/15 text-teal-400"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        }`}
      >
        R
      </button>

      {isRectLike && (
        <span className="flex items-center gap-1 ml-1 text-zinc-500">
          <input
            aria-label="Board width (mm)"
            type="number"
            min={MIN_BOARD_MM}
            step={1}
            value={Math.round(widthMm * 100) / 100}
            onChange={(e) => applySize("width", e.target.value)}
            className="w-14 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-300 focus:outline-none focus:border-teal-600"
          />
          ×
          <input
            aria-label="Board height (mm)"
            type="number"
            min={MIN_BOARD_MM}
            step={1}
            value={Math.round(heightMm * 100) / 100}
            onChange={(e) => applySize("height", e.target.value)}
            className="w-14 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-300 focus:outline-none focus:border-teal-600"
          />
          mm
        </span>
      )}

      {children && <div className="ml-auto flex items-center gap-1">{children}</div>}
    </div>
  );
}
