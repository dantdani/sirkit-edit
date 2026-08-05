"use client";

/**
 * PCB canvas toolbar (PCB Stage 3): select/pan tool toggle, zoom-to-fit,
 * grid on/off, stackup 2/4 switch (proves layer-panel filtering), and board
 * outline controls (size presets, roundrect toggle, numeric width/height mm).
 */

import { Box, CircleDot, Factory, FileDown, Hand, Hexagon, History, Keyboard, Layers, LayoutGrid, ListChecks, Loader2, Maximize2, MousePointer, Redo2, ShieldCheck, Sparkles, Spline, Square, Type, Undo2, Zap } from "lucide-react";
import type { BoardOutline } from "@/app/lib/pcb/types";
import type { ReadinessViewModel } from "@/app/lib/pcb/readiness/types";
import type { PcbHistoryRecord } from "@/app/lib/pcb/history";
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
  onAutoPlace,
  onCancelAutoPlace,
  autoPlacing,
  autoPlaceProgress,
  onRouteBoard,
  routing,
  routingElapsedMs,
  onRunDrc,
  drcRunning,
  onExportKicad,
  onSendToFab,
  onShowShortcuts,
  onAddPlane,
  zoneFilling,
  onToggle3d,
  preview3dOpen,
  onTogglePadstacks,
  padstacksOpen,
  onToggleAssignments,
  assignmentsOpen,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  historyEntries,
  readiness,
  children,
}: {
  tool: "select" | "pan" | "route" | "zone" | "silk"; // Stages 7/11/16 add route/zone/silk
  onToolChange: (tool: "select" | "pan" | "route" | "zone" | "silk") => void;
  onZoomToFit: () => void;
  gridOn: boolean;
  onToggleGrid: () => void;
  stackup: 2 | 4;
  onStackupChange: (stackup: 2 | 4) => void;
  outline: BoardOutline;
  onOutlineChange: (outline: BoardOutline) => void;
  /** Stage 8: one-click auto-place (button hidden when absent). */
  onAutoPlace?: () => void;
  onCancelAutoPlace?: () => void;
  autoPlacing?: boolean;
  autoPlaceProgress?: number;
  /** Stage 9: one-click Freerouting autoroute (button hidden when absent). */
  onRouteBoard?: () => void;
  routing?: boolean;
  routingElapsedMs?: number;
  /** Stage 12: run the batch DRC (button hidden when absent). */
  onRunDrc?: () => void;
  drcRunning?: boolean;
  /** Stage 13: export the board as .kicad_pcb (button hidden when absent). */
  onExportKicad?: () => void;
  /** Stage 14: open the "Send to fab" bundle dialog (button hidden when absent). */
  onSendToFab?: () => void;
  /** Stage 16: open the keyboard-shortcut cheat sheet (button hidden when absent). */
  onShowShortcuts?: () => void;
  /** Stage 11: open the "Fill layer as plane" dialog (button hidden when absent). */
  onAddPlane?: () => void;
  /** Stage 11: a zone re-fill is running (spinner on the Zone button). */
  zoneFilling?: boolean;
  /** Stage 15: toggle the 3D preview panel (button hidden when absent). */
  onToggle3d?: () => void;
  preview3dOpen?: boolean;
  /** Stage 17: toggle the padstack library panel (button hidden when absent). */
  onTogglePadstacks?: () => void;
  padstacksOpen?: boolean;
  onToggleAssignments?: () => void;
  assignmentsOpen?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  historyEntries: readonly PcbHistoryRecord[];
  readiness?: ReadinessViewModel;
  /** Primary schematic-to-PCB action, intentionally first so it stays visible. */
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
      {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
      {children && <div className="w-px h-4 bg-zinc-800 mx-1" />}
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
      <button
        type="button"
        title="Route tracks (R)"
        aria-label="Route tool"
        onClick={() => onToolChange("route")}
        className={iconButtonClass(tool === "route")}
      >
        <Spline className="size-3.5" />
      </button>
      <button
        type="button"
        title="Draw copper zone (Z)"
        aria-label="Zone tool"
        onClick={() => onToolChange("zone")}
        className={iconButtonClass(tool === "zone")}
      >
        {zoneFilling ? <Loader2 className="size-3.5 animate-spin" /> : <Hexagon className="size-3.5" />}
      </button>
      <button
        type="button"
        title="Silkscreen text & graphics (S)"
        aria-label="Silkscreen tool"
        onClick={() => onToolChange("silk")}
        className={iconButtonClass(tool === "silk")}
      >
        <Type className="size-3.5" />
      </button>
      {onAddPlane && (
        <button
          type="button"
          title="Fill layer as plane"
          aria-label="Add plane"
          onClick={onAddPlane}
          className={iconButtonClass(false)}
        >
          <Layers className="size-3.5" />
        </button>
      )}
      {onAutoPlace && (
        <button
          type="button"
          title={autoPlacing ? "Cancel auto-placement" : "Auto-place footprints"}
          aria-label={autoPlacing ? "Cancel auto-placement" : "Auto-place footprints"}
          onClick={autoPlacing ? onCancelAutoPlace : onAutoPlace}
          className={`${iconButtonClass(false)} flex items-center gap-1`}
        >
          {autoPlacing ? <Square className="size-3 fill-current" /> : <Sparkles className="size-3.5" />}
          {autoPlacing && <span className="tabular-nums">{Math.round(autoPlaceProgress ?? 0)}%</span>}
        </button>
      )}
      {onRouteBoard && (
        <button
          type="button"
          title="Autoroute locally with Freerouting (no API key)"
          aria-label="Autoroute board locally with Freerouting"
          onClick={onRouteBoard}
          disabled={routing}
          className={`${iconButtonClass(false)} flex items-center gap-1 disabled:opacity-50`}
        >
          {routing ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          {routing && <span className="tabular-nums">{Math.round((routingElapsedMs ?? 0) / 1000)}s</span>}
        </button>
      )}
      {onRunDrc && (
        <button
          type="button"
          title="Run design rule check"
          aria-label="Run DRC"
          onClick={onRunDrc}
          disabled={drcRunning}
          className={`${iconButtonClass(false)} flex items-center gap-1 disabled:opacity-50`}
        >
          {drcRunning ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
        </button>
      )}
      {onExportKicad && (
        <button
          type="button"
          title="Export KiCad PCB (.kicad_pcb)"
          aria-label="Export KiCad PCB"
          onClick={onExportKicad}
          className={iconButtonClass(false)}
        >
          <FileDown className="size-3.5" />
        </button>
      )}
      {onSendToFab && (
        <button
          type="button"
          title="Send to fab (Gerbers, drill, BOM, pick-and-place)"
          aria-label="Send to fab"
          onClick={onSendToFab}
          className={iconButtonClass(false)}
        >
          <Factory className="size-3.5" />
        </button>
      )}
      {onShowShortcuts && (
        <button
          type="button"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={onShowShortcuts}
          className={iconButtonClass(false)}
        >
          <Keyboard className="size-3.5" />
        </button>
      )}

      <div className="w-px h-4 bg-zinc-800 mx-1" />
      <button
        type="button"
        title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : "Nothing to undo"}
        aria-label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
        onClick={onUndo}
        disabled={!canUndo}
        className={`${iconButtonClass(false)} disabled:opacity-30 disabled:hover:bg-transparent`}
      >
        <Undo2 className="size-3.5" />
      </button>
      <button
        type="button"
        title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Y)` : "Nothing to redo"}
        aria-label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
        onClick={onRedo}
        disabled={!canRedo}
        className={`${iconButtonClass(false)} disabled:opacity-30 disabled:hover:bg-transparent`}
      >
        <Redo2 className="size-3.5" />
      </button>
      <details className="group relative">
        <summary title="Edit history" aria-label="Edit history" className={`${iconButtonClass(false)} list-none cursor-pointer`}>
          <History className="size-3.5" />
        </summary>
        <div className="absolute left-0 top-8 z-[90] w-72 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
          <div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Session edit history</div>
          {historyEntries.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-zinc-500">No board edits in this session.</p>
          ) : (
            <ol className="max-h-64 overflow-y-auto py-1">
              {[...historyEntries].reverse().map((entry) => (
                <li key={entry.id} className={`flex items-start justify-between gap-3 px-3 py-1.5 text-[11px] ${entry.state === "redo" ? "text-zinc-600" : "text-zinc-300"}`}>
                  <span className="min-w-0">
                    <span className="block truncate">{entry.label}</span>
                    <span className="block truncate text-[9px] text-zinc-600">{entry.metadata.operationType}{entry.metadata.affectedObjects.length > 0 ? ` · ${entry.metadata.affectedObjects.slice(0, 3).join(", ")}` : ""}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-[10px] text-zinc-600">
                    {entry.state === "redo" ? "undone" : new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>

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
      {onToggle3d && (
        <button
          type="button"
          title="3D preview"
          aria-label="3D preview"
          onClick={onToggle3d}
          className={iconButtonClass(preview3dOpen === true)}
        >
          <Box className="size-3.5" />
        </button>
      )}
      {onTogglePadstacks && (
        <button
          type="button"
          title="Padstacks"
          aria-label="Padstack library"
          onClick={onTogglePadstacks}
          className={iconButtonClass(padstacksOpen === true)}
        >
          <CircleDot className="size-3.5" />
        </button>
      )}
      {onToggleAssignments && (
        <button type="button" title="Physical assignment queue" aria-label="Physical assignment queue" onClick={onToggleAssignments} className={iconButtonClass(assignmentsOpen === true)}>
          <ListChecks className="size-3.5" />
        </button>
      )}

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

      {readiness && <span
        title={readiness.detail}
        className={`ml-1 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
          readiness.state === "ready"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : readiness.state === "verification_incomplete" || readiness.state === "stale"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : "border-red-500/35 bg-red-500/10 text-red-300"
        }`}
      >
        {readiness.label}
        {readiness.remainingConnections > 0 ? ` · ${readiness.remainingConnections} unrouted` : ""}
      </span>}

    </div>
  );
}
