"use client";

/**
 * Shared panel empty state (PCB Stage 16): title + subtitle + optional action.
 * Used by the DRC panel before its first run (and any future panel that loads
 * empty) — one look for "nothing here yet" across the PCB module.
 */

import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  busy,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-1.5 px-4 py-8">
      {Icon && <Icon className="size-6 text-zinc-700" aria-hidden />}
      <p className="text-xs font-medium text-zinc-300">{title}</p>
      <p className="text-[11px] text-zinc-500 leading-snug max-w-52">{subtitle}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          className="mt-2 px-2.5 py-1 rounded bg-teal-600 text-xs text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
