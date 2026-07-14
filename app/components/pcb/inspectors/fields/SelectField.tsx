"use client";

/**
 * Select inspector field (PCB Stage 17 Phase B) — multi-value convention:
 * mixed values show a disabled '—' option; choosing an option commits to all
 * selected items immediately (selects have no draft state to Esc out of).
 */

export function SelectField({
  label,
  values,
  options,
  onCommit,
  disabled,
}: {
  label: string;
  values: string[];
  options: { value: string; label: string }[];
  onCommit(value: string): void;
  disabled?: boolean;
}) {
  const shared =
    values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;

  return (
    <div className="px-3 py-1 flex items-center gap-2">
      <label className="w-16 shrink-0 text-[11px] text-zinc-500">{label}</label>
      <select
        aria-label={label}
        disabled={disabled}
        value={shared ?? ""}
        onChange={(e) => {
          if (e.target.value !== "") onCommit(e.target.value);
        }}
        className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-teal-600 disabled:opacity-50"
      >
        {shared === undefined && (
          <option value="" disabled>
            —
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
