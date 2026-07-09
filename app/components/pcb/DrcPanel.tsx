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

const DOT: Record<DrcSeverity, string> = {
  error: "bg-red-500",
  warning: "bg-amber-400",
  info: "bg-sky-400",
};

function ViolationRow({
  v,
  expanded,
  onToggle,
}: {
  v: DrcViolation;
  expanded: boolean;
  onToggle: () => void;
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
          {expanded && <span className="block mt-1 text-[11px] text-zinc-400 leading-snug">{v.detail}</span>}
        </span>
      </button>
    </li>
  );
}

export function DrcPanel({ drc }: { drc: DrcHandle }): React.JSX.Element {
  const [grouped, setGrouped] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedKinds, setCollapsedKinds] = useState<Set<string>>(new Set());

  const result = drc.lastResult;
  const preset = PRESETS.find((p) => p.id === drc.activePresetId);
  const running = drc.state === "running";
  const errors = result?.violations.filter((v) => v.severity === "error").length ?? 0;
  const warnings = result?.violations.filter((v) => v.severity === "warning").length ?? 0;

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

      {!result ? (
        <div className="px-3 py-4 text-xs text-zinc-500">
          Click <span className="text-zinc-300">Run DRC</span> to check the board against the current preset.
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-xs">
              {errors === 0 && warnings === 0 ? (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">0 errors — clean</span>
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
                            <ViolationRow key={v.id} v={v} expanded={expanded.has(v.id)} onToggle={() => onRow(v)} />
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })
              : result.violations.map((v) => (
                  <ViolationRow key={v.id} v={v} expanded={expanded.has(v.id)} onToggle={() => onRow(v)} />
                ))}
          </ul>
        </>
      )}
    </div>
  );
}
