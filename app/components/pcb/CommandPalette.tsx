"use client";

/**
 * Command palette (PCB Stage 17 Phase D) — Ctrl+K. A hand-rolled fuzzy
 * listbox (the permitted cmdk dependency wasn't needed at this size). Every
 * EditCommand-backed action registers here; actions whose `disabled` reason
 * is set render grayed with the reason. Invariants: fuzzy filter, full
 * keyboard nav (↑/↓/Enter/Esc), click-away close.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

export interface PaletteAction {
  id: string;
  title: string;
  /** Right-aligned hint (section/keys). */
  hint?: string;
  /** Reason the action can't run right now (rendered, not hidden). */
  disabled?: string | null;
  run(): void;
}

/** Subsequence fuzzy match; lower score = better (compact, early matches). */
function fuzzyScore(query: string, title: string): number | null {
  const q = query.toLowerCase();
  const t = title.toLowerCase();
  if (q === "") return 0;
  let ti = 0;
  let first = -1;
  let last = -1;
  for (const ch of q) {
    ti = t.indexOf(ch, ti);
    if (ti === -1) return null;
    if (first === -1) first = ti;
    last = ti;
    ti++;
  }
  return (last - first - q.length + 1) * 2 + first; // spread + start position
}

export function CommandPalette({
  open,
  actions,
  onClose,
}: {
  open: boolean;
  actions: PaletteAction[];
  onClose(): void;
}) {
  return open ? <OpenCommandPalette actions={actions} onClose={onClose} /> : null;
}

function OpenCommandPalette({ actions, onClose }: { actions: PaletteAction[]; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const scored = actions.flatMap((action) => {
      const score = fuzzyScore(query, action.title);
      return score === null ? [] : [{ action, score }];
    });
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.action);
  }, [actions, query]);

  useEffect(() => {
    // A new open session owns fresh query/selection state. Focus after paint.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const selectedIndex = Math.min(index, Math.max(0, filtered.length - 1));

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const runAction = (action: PaletteAction): void => {
    if (action.disabled) return;
    onClose();
    action.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex(Math.min(selectedIndex + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex(Math.max(selectedIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = filtered[selectedIndex];
      if (action) runAction(action);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
    e.stopPropagation(); // the palette owns the keyboard while open
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center pt-20 bg-black/40"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[26rem] max-w-[90%] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 border-b border-zinc-800">
          <Search className="size-3.5 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            aria-label="Search actions"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          <kbd className="shrink-0 px-1 py-0.5 rounded border border-zinc-700 text-[10px] text-zinc-500">
            esc
          </kbd>
        </div>
        <div ref={listRef} role="listbox" className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-600">No matching actions.</p>
          )}
          {filtered.map((action, i) => (
            <button
              key={action.id}
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              disabled={Boolean(action.disabled)}
              onPointerMove={() => setIndex(i)}
              onClick={() => runAction(action)}
              className={`w-full flex items-baseline gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                action.disabled
                  ? "text-zinc-600 cursor-default"
                  : i === selectedIndex
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-300"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{action.title}</span>
              {action.disabled ? (
                <span className="shrink-0 text-[10px] text-zinc-600">{action.disabled}</span>
              ) : (
                action.hint && (
                  <span className="shrink-0 text-[10px] text-zinc-600">{action.hint}</span>
                )
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
