"use client";

/**
 * Numeric inspector field (PCB Stage 17 Phase B) — the pinned multi-value
 * convention: takes an ARRAY of nm values and speaks edit commands.
 * Mixed values render an em-dash placeholder; typing + Enter/blur commits the
 * typed value to ALL items; Esc reverts. The optional `preview` runs the
 * pending value through `previewEdits` (via useLivePreview's 150 ms debounce)
 * and the warning renders under the field — a hint, never a commit blocker.
 */

import { useEffect, useRef, useState } from "react";
import type { EditPreview } from "@/app/lib/pcb/edit/preview";
import { useLivePreview } from "../../hooks/useLivePreview";

/** Format a scaled value: ≤4 decimals, no trailing zeros. */
function fmt(v: number): string {
  let s = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0" || s === "") s = "0";
  return s;
}

export function NumberField({
  label,
  unit,
  scaleFromNm = 1,
  values,
  onCommit,
  preview,
  disabled,
  placeholder = "—",
}: {
  label: string;
  unit?: string;
  /** Display = nm × scale (1e-6 shows mm). Commit converts back and rounds. */
  scaleFromNm?: number;
  values: number[];
  onCommit(nm: number): void;
  /** Dry-run of the pending value; first violation shows under the field. */
  preview?(nm: number): EditPreview;
  disabled?: boolean;
  placeholder?: string;
}) {
  const shared =
    values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
  const display = shared !== undefined ? fmt(shared * scaleFromNm) : "";

  const [draft, setDraft] = useState<string | null>(null);
  const live = useLivePreview(preview);
  const inputRef = useRef<HTMLInputElement>(null);

  // A committed/external change invalidates any stale draft + hint.
  const { clear } = live;
  useEffect(() => {
    setDraft(null);
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display]);

  const parse = (text: string): number | null => {
    const v = Number(text.trim().replace(",", "."));
    return Number.isFinite(v) ? Math.round(v / scaleFromNm) : null;
  };

  const commit = (): void => {
    live.clear();
    if (draft === null) return;
    const nm = parse(draft);
    setDraft(null);
    if (nm === null || (shared !== undefined && nm === shared)) return;
    onCommit(nm);
  };

  const revert = (): void => {
    live.clear();
    setDraft(null);
  };

  return (
    <div className="px-3 py-1">
      <div className="flex items-center gap-2">
        <label className="w-16 shrink-0 text-[11px] text-zinc-500">{label}</label>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          aria-label={label}
          disabled={disabled}
          value={draft ?? display}
          placeholder={shared === undefined ? placeholder : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            live.schedule(parse(e.target.value));
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              inputRef.current?.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation(); // don't clear the canvas selection
              revert();
              inputRef.current?.blur();
            }
          }}
          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600 disabled:opacity-50"
        />
        {unit && <span className="shrink-0 text-[10px] text-zinc-600 w-6">{unit}</span>}
      </div>
      {live.hint && (
        <p className="mt-0.5 ml-[4.5rem] text-[11px] leading-snug text-amber-400">⚠ {live.hint}</p>
      )}
    </div>
  );
}
