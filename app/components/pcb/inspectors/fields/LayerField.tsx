"use client";

/**
 * Layer picker field (PCB Stage 17 Phase B) — SelectField over the canonical
 * LAYERS table, restricted to `allowed` (copper for tracks/zones, silk for
 * text; stackup-aware). KiCad names never appear — displayName only.
 */

import { LAYERS, type LayerId } from "@/app/lib/pcb/layers";
import { SelectField } from "./SelectField";

export function LayerField({
  label = "Layer",
  values,
  allowed,
  onCommit,
  disabled,
}: {
  label?: string;
  values: LayerId[];
  allowed: readonly LayerId[];
  onCommit(layer: LayerId): void;
  disabled?: boolean;
}) {
  const options = LAYERS.filter((l) => allowed.includes(l.id)).map((l) => ({
    value: l.id,
    label: l.displayName,
  }));
  return (
    <SelectField
      label={label}
      values={values}
      options={options}
      onCommit={(v) => onCommit(v as LayerId)}
      disabled={disabled}
    />
  );
}

/** Copper layers legal on this stackup — the track/zone `allowed` list. */
export function copperLayersFor(stackup: 2 | 4): readonly LayerId[] {
  return stackup === 4
    ? (["copperTop", "in1", "in2", "copperBottom"] as const)
    : (["copperTop", "copperBottom"] as const);
}
