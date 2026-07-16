"use client";

import type { PcbBoard } from "@/app/lib/pcb/types";
import type { AutoPlaceResult } from "@/app/lib/pcb/autoplace/types";

const PRESETS = {
  compact: 1.1,
  comfortable: 1.15,
  spacious: 1.2,
} as const;

type SpacingPreset = NonNullable<PcbBoard["placementPreferences"]>["spacingPreset"];

export function PlacementSetup({
  board,
  result,
  onChange,
}: {
  board: PcbBoard;
  result?: AutoPlaceResult;
  onChange: (preferences: NonNullable<PcbBoard["placementPreferences"]>) => void;
}) {
  const preferences = board.placementPreferences ?? { spacingPreset: "comfortable" as const, envelopeScale: 1.15 };
  const setPreset = (preset: SpacingPreset): void => {
    if (preset === "custom") {
      onChange({ spacingPreset: "custom", envelopeScale: preferences.envelopeScale });
      return;
    }
    onChange({ spacingPreset: preset, envelopeScale: PRESETS[preset] });
  };

  return (
    <details className="border-b border-zinc-800 px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Auto-placement spacing
      </summary>
      <label className="mt-2 block text-[10px] text-zinc-500">
        Virtual placement envelope
        <select
          aria-label="Auto-placement spacing preset"
          value={preferences.spacingPreset}
          onChange={(event) => setPreset(event.target.value as SpacingPreset)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200"
        >
          <option value="compact">Compact — 10% extra</option>
          <option value="comfortable">Comfortable — 15% extra</option>
          <option value="spacious">Spacious — 20% extra</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {preferences.spacingPreset === "custom" && (
        <label className="mt-2 block text-[10px] text-zinc-500">
          Extra spacing (%)
          <input
            aria-label="Custom auto-placement spacing percent"
            type="number"
            min={0}
            max={50}
            step={1}
            value={Math.round((preferences.envelopeScale - 1) * 100)}
            onChange={(event) => {
              const percent = Math.max(0, Math.min(50, Number(event.target.value) || 0));
              onChange({ spacingPreset: "custom", envelopeScale: 1 + percent / 100 });
            }}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200"
          />
        </label>
      )}
      <p className="mt-1.5 text-[9px] leading-snug text-zinc-600">
        Placement-only envelope. Pads, courtyard, fabrication, Gerbers and pick-and-place geometry are unchanged.
      </p>
      {result && (
        <div className="mt-2 rounded border border-zinc-800 bg-zinc-950/50 p-2 text-[10px] text-zinc-400">
          <p className={result.report.success ? "text-emerald-400" : "text-amber-400"}>
            {result.report.success ? "Placement constraints satisfied" : "Placement needs review"}
          </p>
          <p>{result.report.footprintsPlaced}/{result.report.totalFootprints} footprints · {result.report.lockedFootprintsPreserved} locked preserved</p>
          <p>{result.report.padsInsideBoard}/{result.report.totalPads} pads inside · {result.report.envelopeOverlaps} envelope overlaps</p>
          <p>{result.report.blockedPadEscapes} blocked escapes · congestion {result.report.congestion}</p>
          <p>Envelope +{Math.round((result.report.envelopeScale - 1) * 100)}%</p>
        </div>
      )}
    </details>
  );
}
