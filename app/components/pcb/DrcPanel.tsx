"use client";

/**
 * DRC violations panel (PCB Stage 12). Preset picker + Run button, a red/amber
 * summary, and a scrollable list of violations. Each row zooms the canvas to the
 * violation and flashes the offending items; expanding shows the plain-English
 * detail. "Group by kind" collapses same-kind violations under one header.
 */

import { useState } from "react";
import { Play, Loader2, ChevronRight, ChevronDown } from "lucide-react";
import { PRESETS } from "@/app/lib/pcb/drc/presets";
import { layerName } from "@/app/lib/pcb/drc/format";
import type { DrcViolation, DrcSeverity, DrcPresetId } from "@/app/lib/pcb/drc/types";
import type { DrcHandle } from "./hooks/useDrc";
import type { PcbRepairHandle } from "./hooks/usePcbRepair";
import { BoardRepairPanel } from "./BoardRepairPanel";
import type { ReadinessReport } from "@/app/lib/pcb/readiness/types";
import { readinessViewModel } from "@/app/lib/pcb/readiness/evaluate";
import type { ConstraintProgram } from "@/app/lib/constraints/types";

const DOT: Record<DrcSeverity, string> = {
  error: "bg-red-500",
  warning: "bg-amber-400",
  info: "bg-sky-400",
};

function ViolationRow({
  v,
  expanded,
  onToggle,
  proposal,
}: {
  v: DrcViolation;
  expanded: boolean;
  onToggle: () => void;
  proposal?: string;
}): React.JSX.Element {
  return (
    <li className="border-b border-zinc-800/60">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-1.5 flex items-start gap-2 hover:bg-zinc-800/50 transition-colors"
      >
        <span className={`mt-1 size-1.5 rounded-full shrink-0 ${DOT[v.severity]}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 shrink-0">{v.kind}</span>
            {v.layer && <span className="text-[10px] text-zinc-600 truncate">{layerName(v.layer)}</span>}
          </span>
          <span className="block text-xs text-zinc-200 leading-snug">{v.summary}</span>
          {expanded && (
            <span className="block mt-1 text-[11px] text-zinc-400 leading-snug">
              <span className="block">{v.detail}</span>
              <span className="mt-1 block text-zinc-500">
                Actual: {v.kind === "incompleteNet" ? v.measuredNm : `${(v.measuredNm / 1_000_000).toFixed(3)} mm`} · Required: {v.kind === "incompleteNet" ? v.thresholdNm : `${(v.thresholdNm / 1_000_000).toFixed(3)} mm`}
              </span>
              {proposal && <span className="mt-1 block text-teal-400">Proposed fix: {proposal}</span>}
              {v.constraintIds && v.constraintIds.length > 0 && (
                <span className="mt-1 block font-mono text-[9px] text-violet-300/80">
                  Rules: {v.constraintIds.join(", ")}
                </span>
              )}
              {v.ruleResolutionHash && <span className="block font-mono text-[9px] text-zinc-600">Resolution: {v.ruleResolutionHash}</span>}
              <span className="mt-1 block text-zinc-600">Clicking this row focuses and highlights the violating geometry.</span>
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export function DrcPanel({ drc, repair, readiness, constraintProgram }: { drc: DrcHandle; repair: PcbRepairHandle; readiness?: ReadinessReport; constraintProgram?: ConstraintProgram }): React.JSX.Element {
  const [grouped, setGrouped] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedKinds, setCollapsedKinds] = useState<Set<string>>(new Set());
  const [showConstraints, setShowConstraints] = useState(false);

  const result = drc.lastResult;
  const preset = PRESETS.find((p) => p.id === drc.activePresetId);
  const running = drc.state === "running";
  const errors = result?.summary.errors ?? 0;
  const warnings = result?.summary.warnings ?? 0;
  const readinessView = readiness ? readinessViewModel(readiness) : undefined;

  const onRow = (v: DrcViolation): void => {
    drc.zoomToViolation(v);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(v.id)) next.delete(v.id);
      else next.add(v.id);
      return next;
    });
  };

  const groups = new Map<string, DrcViolation[]>();
  if (grouped && result) {
    for (const v of result.violations) {
      const list = groups.get(v.kind) ?? [];
      list.push(v);
      groups.set(v.kind, list);
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 border-t border-zinc-800">
      <div className="px-3 py-2 border-b border-zinc-800 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-300">Design rule check</span>
          {result && <span className="text-[10px] text-zinc-500 tabular-nums">{result.stats.elapsedMs.toFixed(0)} ms</span>}
        </div>
        <select
          value={drc.activePresetId}
          onChange={(e) => drc.setActivePresetId(e.target.value as DrcPresetId)}
          className="w-full bg-zinc-800 text-xs text-zinc-200 rounded px-1.5 py-1 border border-zinc-700 focus:outline-none focus:border-teal-500"
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void drc.run()}
            disabled={running}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 transition-colors disabled:opacity-50"
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run DRC
          </button>
          {preset && <span className="text-[10px] text-zinc-500">verified {preset.verifiedAt}</span>}
        </div>
      </div>

      {constraintProgram && (
        <div className="border-b border-violet-900/40 bg-violet-950/10 px-3 py-2 text-[10px] text-zinc-400">
          <button type="button" onClick={() => setShowConstraints((value) => !value)} className="flex w-full items-center justify-between text-left">
            <span className="font-medium text-violet-300">Typed constraint program</span>
            <span className="font-mono text-[9px] text-zinc-500">{constraintProgram.programHash.slice(0, 18)}…</span>
          </button>
          <div className="mt-1 flex gap-2">
            <span>{constraintProgram.activeConstraintIds.length} active</span>
            <span>{constraintProgram.conflicts.length} conflicts</span>
            <span>{constraintProgram.coverage.filter((item) => ["unsupported", "unknown", "declarative_only"].includes(item.support)).length} incomplete coverage</span>
          </div>
          {showConstraints && (
            <div className="mt-2 max-h-36 space-y-1 overflow-y-auto border-t border-violet-900/30 pt-2">
              {constraintProgram.coverage.map((item) => (
                <div key={`${item.constraintId}:${item.consumerId}`} className="rounded bg-zinc-950/40 px-2 py-1">
                  <div className="flex justify-between gap-2"><span className="truncate font-mono text-violet-200">{item.constraintId}</span><span className={item.support === "enforced" ? "text-emerald-400" : "text-amber-400"}>{item.support}</span></div>
                  <div className="truncate text-zinc-600">{item.consumerId} · {item.targetIds.length} target(s)</div>
                </div>
              ))}
              {constraintProgram.coverage.length === 0 && <p>No active target coverage.</p>}
            </div>
          )}
        </div>
      )}

      {!result ? (
        <div className="px-3 py-4 text-xs text-zinc-500">
          Click <span className="text-zinc-300">Run DRC</span> to check the board against the current preset.
        </div>
      ) : (
        <>
          {readinessView && <div className={`border-b px-3 py-2 text-[11px] ${
            readinessView.state === "ready" ? "border-emerald-900/50 bg-emerald-950/15 text-emerald-300" :
              readinessView.state === "blocked" ? "border-red-900/50 bg-red-950/15 text-red-300" :
                "border-amber-900/50 bg-amber-950/15 text-amber-300"
          }`}>
            <p className="font-medium">{readinessView.label}</p>
            <p className="mt-0.5 text-[10px] opacity-75">{readinessView.detail}</p>
          </div>}
          <BoardRepairPanel result={result} repair={repair} />
          <div className="px-3 py-2 border-b border-zinc-800 shrink-0 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                {result.summary.state === "passed" ? (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">DRC complete</span>
                ) : (
                  <>
                    {errors > 0 && <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">{errors} errors</span>}
                    {warnings > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">{warnings} warnings</span>
                    )}
                  </>
                )}
              </div>
              <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer select-none">
                <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="accent-teal-500" />
                Group by kind
              </label>
            </div>
            <p className={`text-[10px] ${result.summary.state === "failed" ? "text-red-300" : result.summary.state !== "passed" ? "text-amber-300" : "text-emerald-300"}`}>
              {result.summary.message}
            </p>
          </div>

          <ul className="overflow-y-auto min-h-0 flex-1">
            {grouped
              ? [...groups.entries()].map(([kind, list]) => {
                  const isCollapsed = collapsedKinds.has(kind);
                  return (
                    <li key={kind}>
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedKinds((prev) => {
                            const next = new Set(prev);
                            if (next.has(kind)) next.delete(kind);
                            else next.add(kind);
                            return next;
                          })
                        }
                        className="w-full text-left px-2 py-1 flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-900/60 hover:bg-zinc-800/60"
                      >
                        {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                        <span className="uppercase tracking-wide">{kind}</span>
                        <span className="text-zinc-600">({list.length})</span>
                      </button>
                      {!isCollapsed && (
                        <ul>
                          {list.map((v) => (
                            <ViolationRow key={v.id} v={v} expanded={expanded.has(v.id)} onToggle={() => onRow(v)} proposal={repair.plan?.violations.find((item) => item.id === v.id)?.candidateFixes[0]?.label} />
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })
              : result.violations.map((v) => (
                  <ViolationRow key={v.id} v={v} expanded={expanded.has(v.id)} onToggle={() => onRow(v)} proposal={repair.plan?.violations.find((item) => item.id === v.id)?.candidateFixes[0]?.label} />
                ))}
          </ul>
        </>
      )}
    </div>
  );
}
