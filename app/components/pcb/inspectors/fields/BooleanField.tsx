"use client";

/**
 * Boolean inspector field (PCB Stage 17 Phase B) — multi-value convention:
 * mixed booleans render an indeterminate checkbox; clicking commits `true`
 * first (indeterminate → checked → unchecked on the next click).
 */

import { useEffect, useRef } from "react";

export function BooleanField({
  label,
  values,
  onCommit,
  disabled,
}: {
  label: string;
  values: boolean[];
  onCommit(value: boolean): void;
  disabled?: boolean;
}) {
  const shared =
    values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = shared === undefined;
  }, [shared]);

  return (
    <label className="px-3 py-1 flex items-center gap-2 cursor-pointer">
      <span className="w-16 shrink-0 text-[11px] text-zinc-500">{label}</span>
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        checked={shared ?? false}
        onChange={() => onCommit(shared === undefined ? true : !shared)}
        className="size-3.5 accent-teal-600 disabled:opacity-50"
      />
    </label>
  );
}
