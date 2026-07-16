"use client";

import { useMemo, useState } from "react";
import { Loader2, RotateCcw, Sparkles, Square, Wrench } from "lucide-react";
import type { DrcResult } from "@/app/lib/pcb/drc/types";
import type { PcbRepairHandle } from "./hooks/usePcbRepair";

export function BoardRepairPanel({ result, repair }: { result: DrcResult; repair: PcbRepairHandle }) {
  const [selection, setSelection] = useState<{ planId?: string; ids: Set<string> }>({ ids: new Set() });
  const defaultSelection = useMemo(() => new Set(
    repair.plan?.fixes.filter((fix) => !fix.requiresApproval && fix.action.kind !== "manual_review").map((fix) => fix.id) ?? [],
  ), [repair.plan]);
  const selected = repair.plan && selection.planId === repair.plan.id ? selection.ids : defaultSelection;
  const busy = repair.state === "planning" || repair.state === "previewing" || repair.state === "applying";
  const selectedIds = useMemo(() => [...selected], [selected]);

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/35 p-3 text-[10px] text-zinc-400">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-200"><Wrench className="size-3.5 text-teal-400" /> Board Repair</p>
          <p className="mt-0.5">{result.readiness.errors} errors · {result.readiness.warnings} warnings · {result.readiness.unroutedConnections} unrouted</p>
        </div>
        {busy ? (
          <button type="button" onClick={repair.cancel} className="flex items-center gap-1 rounded border border-amber-700 px-2 py-1 text-[10px] text-amber-300">
            <Square className="size-3 fill-current" /> Cancel
          </button>
        ) : !repair.plan && (
          <button type="button" disabled={busy} onClick={() => void repair.createPlan()} className="flex items-center gap-1 rounded bg-teal-600 px-2 py-1 text-[10px] text-white hover:bg-teal-500 disabled:opacity-50">
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} Fix with AI
          </button>
        )}
      </div>
      {repair.progress && busy && (
        <p className="mt-1 text-zinc-500">
          {repair.progress.phase} · {Math.round(repair.progress.percent)}% · {(repair.progress.elapsedMs / 1000).toFixed(1)}s
        </p>
      )}

      {!repair.plan && (
        <label className="mt-2 block text-zinc-500">
          Execution mode
          <select
            aria-label="PCB repair execution mode"
            value={repair.mode}
            onChange={(event) => repair.setMode(event.target.value as PcbRepairHandle["mode"])}
            className="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300"
          >
            <option value="review_every_change">Review every change</option>
            <option value="safe_fixes_automatically">Safe fixes automatically</option>
            <option value="fully_automatic_within_constraints">Fully automatic within constraints</option>
          </select>
        </label>
      )}

      {repair.plan && (
        <div className="mt-2 space-y-1.5">
          <p className="text-zinc-300">Suggested repair groups</p>
          {repair.plan.groups.map((group) => {
            const fixes = repair.plan!.fixes.filter((fix) => group.fixIds.includes(fix.id));
            const checked = fixes.length > 0 && fixes.every((fix) => selected.has(fix.id));
            return (
              <label key={group.id} className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-900/60 p-1.5">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = new Set(selected);
                    for (const fix of fixes) {
                      if (event.target.checked) next.add(fix.id);
                      else next.delete(fix.id);
                    }
                    setSelection({ planId: repair.plan?.id, ids: next });
                  }}
                  className="mt-0.5 accent-teal-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-zinc-300">{group.title} — {group.violationIds.length || fixes.length}</span>
                  <span className={group.requiresApproval ? "text-amber-400" : "text-zinc-600"}>
                    {group.requiresApproval ? "Approval required" : group.rootCause.replaceAll("_", " ")}
                  </span>
                </span>
              </label>
            );
          })}
          {!repair.preview && (
            <div className="flex gap-2 pt-1">
              <button type="button" disabled={busy || selectedIds.length === 0} onClick={() => void repair.previewFixes(selectedIds)} className="rounded bg-teal-600 px-2 py-1 text-white hover:bg-teal-500 disabled:opacity-40">
                {repair.state === "previewing" ? "Preparing…" : "Preview fixes"}
              </button>
              <button type="button" onClick={() => void repair.createPlan()} className="rounded border border-zinc-700 px-2 py-1 text-zinc-400">Refresh plan</button>
            </div>
          )}
        </div>
      )}

      {repair.preview && (
        <div className="mt-2 rounded border border-teal-900/60 bg-teal-950/20 p-2">
          <p className="text-zinc-200">Validated repair preview</p>
          <p>Errors: {repair.preview.metrics.errorsBefore} → {repair.preview.metrics.errorsAfter}</p>
          <p>Warnings: {repair.preview.metrics.warningsBefore} → {repair.preview.metrics.warningsAfter}</p>
          <p>Unrouted: {repair.preview.metrics.unroutedBefore} → {repair.preview.metrics.unroutedAfter}</p>
          <p>Moved footprints: {repair.preview.metrics.movedFootprints} · rerouted nets: {repair.preview.metrics.reroutedNets.join(", ") || "none"}</p>
          <p className={repair.preview.metrics.newViolationsIntroduced === 0 ? "text-emerald-400" : "text-red-400"}>New violations: {repair.preview.metrics.newViolationsIntroduced}</p>
          <div className="mt-2 flex gap-2">
            {repair.state !== "done" ? (
              <button type="button" disabled={busy || repair.preview.blockers.length > 0} onClick={() => void repair.applyPreview(selectedIds)} className="rounded bg-teal-600 px-2 py-1 text-white hover:bg-teal-500 disabled:opacity-40">
                {repair.state === "applying" ? "Applying…" : "Apply selected fixes"}
              </button>
            ) : (
              <button type="button" onClick={() => void repair.undoLast()} className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-zinc-300"><RotateCcw className="size-3" /> Undo repair</button>
            )}
          </div>
        </div>
      )}
      {repair.error && <p className="mt-2 text-red-400">{repair.error}</p>}
    </div>
  );
}
