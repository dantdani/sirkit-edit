"use client";

/**
 * Keyboard-shortcut cheat sheet (PCB Stage 16). Opened by `?` anywhere in the
 * PCB module (or the toolbar button). SHORTCUTS_TABLE is the single source of
 * truth — every row maps to a real binding, so docs can't drift from code.
 * Focus moves into the dialog on open (Esc closes it from anywhere inside).
 */

import { useEffect, useRef } from "react";

export interface ShortcutRow {
  keys: string;
  action: string;
}

export const SHORTCUTS_TABLE: { group: string; rows: ShortcutRow[] }[] = [
  {
    group: "Navigation",
    rows: [
      { keys: "Wheel", action: "Zoom at cursor" },
      { keys: "Middle-drag", action: "Pan (any tool)" },
      { keys: "Toolbar ⤢", action: "Zoom to fit" },
    ],
  },
  {
    group: "Tools",
    rows: [
      { keys: "R", action: "Route tracks (rotates 90° CW when parts are selected)" },
      { keys: "Z", action: "Draw copper zone" },
      { keys: "S", action: "Silkscreen text & graphics" },
      { keys: "F", action: "Flip selected parts to the other side" },
      { keys: "Arrows", action: "Nudge selection 0.5 mm (Shift = 0.1 mm)" },
      { keys: "Esc", action: "Cancel in-progress item / clear selection" },
      { keys: "Enter", action: "Commit (zone polygon, silk text, line chain)" },
    ],
  },
  {
    group: "While routing",
    rows: [
      { keys: "V", action: "Place via and switch layer" },
      { keys: "Tab", action: "Toggle bend direction (H-first ↔ V-first)" },
      { keys: "Backspace", action: "Undo last segment" },
      { keys: "X", action: "Cancel the current trace" },
    ],
  },
  {
    group: "History",
    rows: [
      { keys: "Ctrl+Z", action: "Undo" },
      { keys: "Ctrl+Shift+Z / Ctrl+Y", action: "Redo" },
    ],
  },
  {
    group: "Actions",
    rows: [
      { keys: "Ctrl+P", action: "Auto-place footprints" },
      { keys: "Ctrl+E", action: "Autoroute board (Freerouting)" },
      { keys: "Ctrl+D", action: "Run design rule check" },
      { keys: "Ctrl+3", action: "Toggle 3D preview" },
      { keys: "Ctrl+B", action: "Send to fab (Gerber bundle)" },
    ],
  },
  {
    group: "Help",
    rows: [{ keys: "?", action: "This cheat sheet" }],
  },
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="w-[30rem] max-h-[85vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-xs shadow-xl outline-none"
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-zinc-100">Keyboard shortcuts</p>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Esc
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {SHORTCUTS_TABLE.map((section) => (
            <div key={section.group}>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">{section.group}</p>
              <ul className="flex flex-col gap-1">
                {section.rows.map((row) => (
                  <li key={row.keys} className="flex items-baseline gap-2">
                    <kbd className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono text-[10px]">
                      {row.keys}
                    </kbd>
                    <span className="text-zinc-400 leading-snug">{row.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
