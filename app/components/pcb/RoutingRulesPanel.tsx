"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Save, SlidersHorizontal, Sparkles, WandSparkles, X } from "lucide-react";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { NetClassId, RuleDelta, RuleDeltaChange } from "@/app/lib/pcb/netclass";
import type { NetClassHandle } from "./hooks/useNetClass";

function scopeText(change: RuleDeltaChange): string {
  const scope = change.appliesTo;
  if (scope.kind === "class") return `${scope.classId} class`;
  if (scope.kind === "nets") return `nets ${scope.netIds.join(", ")}`;
  return `names /${scope.regex}/`;
}

function dimensionsText(change: RuleDeltaChange): string {
  const values: string[] = [];
  if (change.className) values.push(change.className);
  if (change.trackWidthNm !== undefined) values.push(`track ${(change.trackWidthNm / 1e6).toFixed(2)} mm`);
  if (change.clearanceNm !== undefined) values.push(`clearance ${(change.clearanceNm / 1e6).toFixed(2)} mm`);
  if (change.viaSizeNm !== undefined || change.viaDrillNm !== undefined) {
    values.push(`via ${change.viaSizeNm !== undefined ? (change.viaSizeNm / 1e6).toFixed(2) : "inherit"}/${change.viaDrillNm !== undefined ? (change.viaDrillNm / 1e6).toFixed(2) : "inherit"} mm`);
  }
  return values.join(" · ");
}

export function RoutingRulesPanel({
  board,
  netClasses,
  toast,
}: {
  board: PcbBoard;
  netClasses: NetClassHandle;
  toast(message: string): void;
}) {
  const [open, setOpen] = useState(true);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<RuleDelta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedNetId, setSelectedNetId] = useState<number | null>(null);
  const [manual, setManual] = useState({ classId: "Default" as NetClassId, track: "0.25", clearance: "0.20", viaSize: "0.80", viaDrill: "0.40" });
  const [manualError, setManualError] = useState<string | null>(null);
  const nets = board.nets.filter((net) => net.id !== 0);

  const loadNet = (netId: number): void => {
    const rule = netClasses.getClassForNet(netId);
    setSelectedNetId(netId);
    setManual({
      classId: rule.id,
      track: (rule.trackWidth / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, ""),
      clearance: (rule.clearance / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, ""),
      viaSize: (rule.viaSize / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, ""),
      viaDrill: (rule.viaDrill / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, ""),
    });
    setManualError(null);
  };

  const openRuleEditor = (): void => {
    if (nets[0]) loadNet(nets[0].id);
    setEditorOpen(true);
  };

  const saveManual = (): void => {
    if (selectedNetId === null) return;
    const trackWidthNm = Math.round(Number(manual.track) * 1e6);
    const clearanceNm = Math.round(Number(manual.clearance) * 1e6);
    const viaSizeNm = Math.round(Number(manual.viaSize) * 1e6);
    const viaDrillNm = Math.round(Number(manual.viaDrill) * 1e6);
    if (![trackWidthNm, clearanceNm, viaSizeNm, viaDrillNm].every((value) => Number.isFinite(value) && value > 0)) {
      setManualError("Enter positive millimeter values for every routing rule.");
      return;
    }
    if (viaDrillNm >= viaSizeNm) {
      setManualError("Via drill must be smaller than the via outer diameter.");
      return;
    }
    netClasses.applyManualRules(selectedNetId, { classId: manual.classId, trackWidthNm, clearanceNm, viaSizeNm, viaDrillNm });
    setManualError(null);
    toast("Routing rules saved. New routes use them now; DRC will check existing copper against them. Undo is available.");
  };

  const suggest = async (): Promise<void> => {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError(null);
    setProposal(null);
    const result = await netClasses.suggestBrief(brief.trim());
    setBusy(false);
    if (result.ok) setProposal(result.delta);
    else setError(result.error);
  };

  return (
    <section data-testid="routing-rules-panel" className="border-t border-zinc-800">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/40"
      >
        {open ? <ChevronDown className="size-3 text-zinc-500" /> : <ChevronRight className="size-3 text-zinc-500" />}
        <WandSparkles className="size-3.5 text-violet-400" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Routing intelligence</span>
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto px-3 pb-3 space-y-2.5">
          <div className="rounded border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-800">
            {nets.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-zinc-500">No connected nets yet.</p>
            ) : nets.slice(0, 6).map((net) => {
              const rule = netClasses.getClassForNet(net.id);
              return (
                <div key={net.id} className="px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate font-medium text-zinc-200">{net.name || `Net ${net.id}`}</span>
                    <span className="shrink-0 text-zinc-500">{rule.name}</span>
                  </div>
                  <p className="text-[10px] text-zinc-500">
                    {(rule.trackWidth / 1e6).toFixed(2)} mm · via {(rule.viaSize / 1e6).toFixed(2)}/{(rule.viaDrill / 1e6).toFixed(2)} mm
                  </p>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { netClasses.runAutoClassify(); toast("Nets classified by name and topology — undo is available."); }}
            disabled={nets.length === 0}
            className="w-full rounded border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40"
          >
            Classify nets deterministically
          </button>
          <button
            type="button"
            onClick={openRuleEditor}
            disabled={nets.length === 0}
            className="w-full flex items-center justify-center gap-1.5 rounded border border-teal-500/35 bg-teal-500/10 px-2 py-1.5 text-[11px] text-teal-300 hover:bg-teal-500/20 disabled:opacity-40"
          >
            <SlidersHorizontal className="size-3" />
            Edit routing rules
          </button>
          <div>
            <label className="block text-[11px] text-zinc-400" htmlFor="routing-ai-brief">Board intent</label>
            <textarea
              id="routing-ai-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Example: 2 A USB-C input, 1 oz copper, 10 °C rise"
              rows={3}
              className="mt-1 w-full resize-none rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void suggest()}
              disabled={busy || brief.trim() === ""}
              className="mt-1.5 w-full flex items-center justify-center gap-1.5 rounded bg-violet-500/15 px-2 py-1.5 text-[11px] text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              Suggest track widths and vias
            </button>
          </div>
          {error && <p className="rounded border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-300">{error}</p>}
          {proposal && (
            <div className="rounded border border-violet-500/30 bg-violet-500/10 p-2">
              <p className="text-[10px] leading-snug text-violet-100">{proposal.explanation}</p>
              <ul className="mt-1.5 space-y-1">
                {proposal.changes.map((change, index) => (
                  <li key={`${proposal.id}-${index}`} className="text-[10px] text-zinc-300">
                    <span className="text-zinc-500">{scopeText(change)}:</span> {dimensionsText(change)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-zinc-500">Preview only — nothing changes until you apply it.</p>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => { netClasses.applyDelta(proposal); setProposal(null); toast("AI routing rules applied as one undoable change."); }}
                  className="flex-1 rounded bg-violet-600 px-2 py-1 text-[11px] text-white hover:bg-violet-500"
                >
                  Apply proposal
                </button>
                <button type="button" onClick={() => setProposal(null)} className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:text-white">
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {editorOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="Routing rules editor">
          <div className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex items-start justify-between border-b border-zinc-800 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Routing rules</h2>
                <p className="mt-0.5 text-[11px] text-zinc-500">Values apply to interactive routing immediately and become DRC minimums for existing copper.</p>
              </div>
              <button type="button" aria-label="Close routing rules editor" onClick={() => setEditorOpen(false)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-[190px_1fr]">
              <div>
                <label htmlFor="manual-rule-net" className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Net</label>
                <select
                  id="manual-rule-net"
                  value={selectedNetId ?? ""}
                  onChange={(event) => loadNet(Number(event.target.value))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200 focus:border-teal-500 focus:outline-none"
                >
                  {nets.map((net) => <option key={net.id} value={net.id}>{net.name || `Net ${net.id}`}</option>)}
                </select>
                <p className="mt-3 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[10px] leading-relaxed text-zinc-500">
                  Saving creates one named history command. Undo restores all five values together.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 text-[11px] text-zinc-400">
                  Net class
                  <select value={manual.classId} onChange={(event) => setManual((value) => ({ ...value, classId: event.target.value as NetClassId }))} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200 focus:border-teal-500 focus:outline-none">
                    <option value="Default">Default</option>
                    <option value="Power">Power</option>
                    <option value="HighCurrent">High current</option>
                  </select>
                </label>
                {([
                  ["track", "Track width", "0.01"],
                  ["clearance", "Clearance", "0.01"],
                  ["viaSize", "Via outer diameter", "0.01"],
                  ["viaDrill", "Via drill", "0.01"],
                ] as const).map(([key, label, step]) => (
                  <label key={key} className="text-[11px] text-zinc-400">
                    {label} (mm)
                    <input
                      aria-label={`${label} (mm)`}
                      type="number"
                      min="0.01"
                      step={step}
                      value={manual[key]}
                      onChange={(event) => setManual((value) => ({ ...value, [key]: event.target.value }))}
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs tabular-nums text-zinc-100 focus:border-teal-500 focus:outline-none"
                    />
                  </label>
                ))}
                {manualError && <p className="col-span-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">{manualError}</p>}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
              <p className="text-[10px] text-zinc-500">AI suggestions remain previews until explicitly applied.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditorOpen(false)} className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-white">Close</button>
                <button type="button" onClick={saveManual} className="flex items-center gap-1.5 rounded bg-teal-600 px-3 py-1.5 text-xs text-white hover:bg-teal-500">
                  <Save className="size-3.5" /> Save rules
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
