"use client";

/**
 * Padstack picker field (PCB Stage 17). Phase B ships the shell — boards have
 * no padstack library until the Phase C migration runs, so an empty list
 * renders a disabled hint row. Phase C wires the real registry + fork rule.
 */

import type { Padstack } from "@/app/lib/pcb/padstack/types";
import { formatMm } from "@/app/lib/pcb/units";
import { SelectField } from "./SelectField";

export function PadstackField({
  padstacks,
  values,
  onCommit,
  disabled,
}: {
  padstacks: Padstack[];
  /** Selected vias' padstackIds ('' = legacy via without one). */
  values: string[];
  onCommit(padstackId: string): void;
  disabled?: boolean;
}) {
  if (padstacks.length === 0) {
    return (
      <div className="px-3 py-1 flex items-center gap-2">
        <span className="w-16 shrink-0 text-[11px] text-zinc-500">Padstack</span>
        <span className="flex-1 text-xs text-zinc-600">None yet</span>
      </div>
    );
  }
  return (
    <SelectField
      label="Padstack"
      values={values}
      options={padstacks.map((p) => ({
        value: p.id,
        label: `${p.name} (${formatMm(p.outerNm)}/${formatMm(p.drillNm)})`,
      }))}
      onCommit={onCommit}
      disabled={disabled}
    />
  );
}
