"use client";

import type { PcbBoard } from "@/app/lib/pcb/types";
import type { AutoPlaceResult } from "@/app/lib/pcb/autoplace/types";
import type { PlacementLayoutCandidate } from "@/app/lib/pcb/candidates/layout-candidate";

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
  onApply,
  onDiscard,
  candidates = [],
  onApplyCandidate,
  onDiscardCandidate,
}: {
  board: PcbBoard;
  result?: AutoPlaceResult;
  onChange: (preferences: NonNullable<PcbBoard["placementPreferences"]>) => void;
  onApply?: () => void;
  onDiscard?: () => void;
  /** [B17-E] every live placement candidate in the shared store — the editor's, an agent's, a route's — same format, same apply. */
  candidates?: PlacementLayoutCandidate[];
  onApplyCandidate?: (candidateId: string) => void;
  onDiscardCandidate?: (candidateId: string) => void;
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
      {candidates.length > 0 && (
        <ul className="mt-2 space-y-1" data-testid="placement-candidates">
          {candidates.map((candidate) => (
            <li key={candidate.candidateId} data-testid="placement-candidate" data-producer={candidate.producer} data-candidate-id={candidate.candidateId} className="rounded border border-zinc-800 bg-zinc-950/50 p-1.5 text-[10px] text-zinc-400">
              <p className="flex items-center gap-1">
                <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] uppercase text-zinc-300">{candidate.producer}</span>
                <span className="font-mono text-[9px] text-cyan-400" title={candidate.candidateId}>{candidate.candidateId.slice(0, 12)}</span>
                <span className={candidate.legal ? "text-emerald-400" : "text-amber-400"}>{candidate.legal ? "legal" : "not hard-legal"}</span>
              </p>
              <p>{candidate.candidate.moves.length} moves · {candidate.scope.instanceIds === "all" ? "whole board" : `${candidate.scope.instanceIds.length} selected`} · base {candidate.base.revision.slice(0, 12)}</p>
              <div className="mt-1 flex gap-1">
                <button type="button" aria-label={`Apply placement candidate ${candidate.candidateId}`} onClick={() => onApplyCandidate?.(candidate.candidateId)} disabled={!candidate.legal} className="rounded bg-teal-600 px-2 py-0.5 text-white disabled:cursor-not-allowed disabled:opacity-40">Apply</button>
                <button type="button" aria-label={`Discard placement candidate ${candidate.candidateId}`} onClick={() => onDiscardCandidate?.(candidate.candidateId)} className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300">Discard</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {result && (
        <div className="mt-2 rounded border border-zinc-800 bg-zinc-950/50 p-2 text-[10px] text-zinc-400">
          <p className={result.report.success ? "text-emerald-400" : "text-amber-400"}>
            {result.report.success ? "Placement constraints satisfied" : "Placement needs review"}
          </p>
          <p>{result.report.footprintsPlaced}/{result.report.totalFootprints} footprints · {result.report.lockedFootprintsPreserved} locked preserved</p>
          <p>{result.report.padsInsideBoard}/{result.report.totalPads} pads inside · {result.report.envelopeOverlaps} envelope overlaps</p>
          <p>{result.report.blockedPadEscapes} blocked escapes · congestion {result.report.congestion}</p>
          <p>Envelope +{Math.round((result.report.envelopeScale - 1) * 100)}%</p>
          {result.engineering && (() => {
            const candidate = result.engineering.selectedCandidate;
            return (
              <div className="mt-2 border-t border-zinc-800 pt-2">
                <p className="font-mono text-[9px] text-cyan-400" title={candidate.candidateId}>
                  {candidate.candidateHash.slice(0, 15)} · {result.engineering.termination.replaceAll("_", " ")}
                </p>
                <p>{candidate.moves.length} moved · {candidate.moves.filter((move) => move.rotated).length} rotated · {candidate.moves.filter((move) => move.flipped).length} flipped</p>
                <p>{candidate.congestion.totalOverflowTracks.toFixed(2)} total overflow · {candidate.congestion.maximumOverflowTracks.toFixed(2)} max</p>
                <p>{candidate.congestion.overCapacityCutlines} overloaded cutlines · {candidate.viaPressure.maximumPressure.toFixed(2)} max via pressure</p>
                <p>{candidate.pinEscape.deficits} escape deficits · {candidate.pinEscape.unknown} unknown</p>
                <p className="text-cyan-300">Cyan ghost preview is active; the board is unchanged until Apply.</p>
                {candidate.copperPlan.requiresRoutingFollowUp && (
                  <p className="mt-1 text-amber-400">Would remove {candidate.copperPlan.removeTrackIds.length} generated tracks and {candidate.copperPlan.removeViaIds.length} generated vias; affected nets become incomplete.</p>
                )}
                {candidate.objectiveReport.objectives.filter((objective) => objective.state === "evaluated").slice(0, 6).map((objective) => (
                  <p key={objective.id} className="flex justify-between gap-2">
                    <span>{objective.kind.replaceAll("_", " ")}</span>
                    <span className="tabular-nums">{objective.normalizedPenalty?.toFixed(3) ?? "—"} × {objective.weight}</span>
                  </p>
                ))}
                {candidate.hardReport.violations.slice(0, 4).map((violation) => (
                  <p key={violation.id} className="mt-1 text-rose-400">{violation.code}: {violation.message}</p>
                ))}
                <p className="mt-1 text-[9px] text-zinc-600">Capacity, escape, via, thermal and high-speed values are placement estimates—not routing or signoff.</p>
                <div className="mt-2 flex gap-1">
                  <button type="button" onClick={onApply} disabled={!candidate.hardReport.legal} className="rounded bg-teal-600 px-2 py-1 text-white disabled:cursor-not-allowed disabled:opacity-40">Apply candidate</button>
                  <button type="button" onClick={onDiscard} className="rounded border border-zinc-700 px-2 py-1 text-zinc-300">Discard</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </details>
  );
}
