"use client";

/**
 * Board context menu (PCB Stage 17) — a small positioned listbox over the
 * canvas. The select-move tool emits a `ContextMenuRequest` on right-click;
 * PcbEditor builds the items (selectSimilar / selectNet / edit commands) and
 * mounts this. Raw Tailwind like every landed PCB panel — no portal, no
 * dependency; it lives inside the canvas wrapper (position: relative).
 */

import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  onClick?(): void;
  disabled?: boolean;
  /** Shown as a muted hint when disabled (e.g. why delete is blocked). */
  reason?: string;
  danger?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose(): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape or any pointer-down outside the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent): void => {
      // No menuRef when items were empty (null render) — still close, or the
      // phantom menu's listeners would swallow the next Escape forever.
      if (!menuRef.current || !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  // Keep the menu inside its positioned parent (flip up/left near edges).
  useEffect(() => {
    const el = menuRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const flipX = x + el.offsetWidth > parent.clientWidth;
    const flipY = y + el.offsetHeight > parent.clientHeight;
    if (flipX) el.style.left = `${Math.max(0, x - el.offsetWidth)}px`;
    if (flipY) el.style.top = `${Math.max(0, y - el.offsetHeight)}px`;
  }, [x, y]);

  if (items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      style={{ left: x, top: y }}
      className="absolute z-50 min-w-44 py-1 rounded border border-zinc-700 bg-zinc-900/95 shadow-xl text-xs"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onClick?.();
          }}
          title={item.disabled ? item.reason : undefined}
          className={`w-full px-3 py-1.5 text-left transition-colors ${
            item.disabled
              ? "text-zinc-600 cursor-default"
              : item.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          {item.label}
          {item.disabled && item.reason && (
            <span className="block text-[10px] text-zinc-600">{item.reason}</span>
          )}
        </button>
      ))}
    </div>
  );
}
