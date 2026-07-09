"use client";

/**
 * Silkscreen tool UI (PCB Stage 16). Floating sub-mode panel (Text / Line /
 * Rect / Circle) with layer + size pickers, and the inline text input that
 * appears after a text-mode click. Canvas interaction lives in useSilkTool;
 * this component is presentation + the text-commit keyboard handling
 * (Enter commits, Esc cancels, Tab cycles silkTop ↔ silkBottom).
 */

import { useEffect, useRef, useState } from "react";
import type { SilkLayer } from "@/app/lib/pcb/silk/types";
import type { SilkMode, SilkToolHandle } from "./hooks/useSilkTool";

const MODES: { id: SilkMode; label: string; hint: string }[] = [
  { id: "text", label: "Text", hint: "Click to place text" },
  { id: "line", label: "Line", hint: "Click to chain segments · Enter ends · Esc cancels" },
  { id: "rect", label: "Rect", hint: "Click two corners · Shift = square" },
  { id: "circle", label: "Circle", hint: "Click center, then radius · Shift snaps 0.5 mm" },
];

const LAYER_LABEL: Record<SilkLayer, string> = {
  silkTop: "Top silk",
  silkBottom: "Bottom silk",
};

const fieldClass =
  "w-14 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200 focus:outline-none focus:border-teal-600";

export function SilkTool({ silk, active }: { silk: SilkToolHandle; active: boolean }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Fresh draft + focus every time a text position lands.
  useEffect(() => {
    if (silk.pendingTextAt) {
      setDraft("");
      inputRef.current?.focus();
    }
  }, [silk.pendingTextAt]);

  if (!active) return null;

  const hint = MODES.find((m) => m.id === silk.mode)?.hint ?? "";

  return (
    <>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 p-2 rounded border border-zinc-700 bg-zinc-900/95 shadow-lg text-xs flex flex-col gap-2 w-64">
        <div className="flex items-center gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => silk.setMode(m.id)}
              className={`px-2 py-1 rounded transition-colors ${
                silk.mode === m.id
                  ? "bg-teal-500/15 text-teal-400"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Silk layer"
            value={silk.layer}
            onChange={(e) => silk.setLayer(e.target.value as SilkLayer)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200 focus:outline-none focus:border-teal-600"
          >
            {(Object.keys(LAYER_LABEL) as SilkLayer[]).map((l) => (
              <option key={l} value={l}>
                {LAYER_LABEL[l]}
              </option>
            ))}
          </select>
          {silk.mode === "text" && (
            <label className="flex items-center gap-1 text-zinc-500">
              H
              <input
                aria-label="Text height (mm)"
                type="number"
                min={0.5}
                step={0.25}
                value={silk.heightMm}
                onChange={(e) => silk.setHeightMm(Math.max(0.1, Number(e.target.value) || 1))}
                className={fieldClass}
              />
            </label>
          )}
          <label className="flex items-center gap-1 text-zinc-500">
            W
            <input
              aria-label="Stroke width (mm)"
              type="number"
              min={0.1}
              step={0.05}
              value={silk.strokeMm}
              onChange={(e) => silk.setStrokeMm(Math.max(0.05, Number(e.target.value) || 0.15))}
              className={fieldClass}
            />
          </label>
        </div>
        <p className="text-zinc-500">{hint}</p>
      </div>

      {silk.pendingTextAt && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 p-2 rounded border border-zinc-700 bg-zinc-900/95 shadow-lg text-xs flex items-center gap-2">
          <input
            ref={inputRef}
            aria-label="Silk text"
            value={draft}
            placeholder={`Text on ${LAYER_LABEL[silk.layer]}…`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                silk.commitText(draft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                silk.cancelText();
              } else if (e.key === "Tab") {
                e.preventDefault();
                silk.toggleLayer(); // Tab cycles silkTop ↔ silkBottom (pinned)
              }
            }}
            className="w-52 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-teal-600"
          />
          <span className="text-zinc-500">{LAYER_LABEL[silk.layer]} · Enter commits</span>
        </div>
      )}
    </>
  );
}
