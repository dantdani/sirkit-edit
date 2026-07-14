"use client";

/** Read-only inspector row (PCB Stage 17). Same grid as the editable fields. */

export function ReadonlyRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="px-3 py-1">
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[11px] text-zinc-500">{label}</span>
        <span className="flex-1 min-w-0 truncate text-xs text-zinc-300" title={value}>
          {value}
        </span>
      </div>
      {hint && <p className="mt-0.5 ml-[4.5rem] text-[10px] text-zinc-600">{hint}</p>}
    </div>
  );
}
