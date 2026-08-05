"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, LockKeyhole, Route, ShieldCheck } from "lucide-react";
import type { PcbSyncPreflightResult, PcbSyncRiskClass } from "@/app/lib/pcb-sync/types";

const riskOrder: PcbSyncRiskClass[] = ["none", "metadata_only", "unrouted_structural", "copper_affecting", "constraint_affecting", "destructive", "unsupported_unknown"];

export function PcbSyncReadinessPanel({ result, busy = false, onApply }: { result: PcbSyncPreflightResult; busy?: boolean; onApply?: (planId: string, planDigest: string) => void }) {
  const [confirmedPreflightId, setConfirmedPreflightId] = useState<string | null>(null);
  const confirmed = confirmedPreflightId === result.preflightId;
  const operationsByRisk = useMemo(() => riskOrder.map((risk) => ({ risk, count: result.plan?.operations.filter((item) => item.risk === risk).length ?? 0 })).filter((item) => item.count > 0), [result.plan]);
  const canApply = result.status === "ready_to_apply" && result.plan?.lifecycle === "applicable" && result.blockers.length === 0 && Boolean(onApply);
  const targetLabel = result.board.boardClass.replaceAll("_", " ");
  return (
    <section aria-label="PCB synchronization readiness" className="rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs text-zinc-300">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 font-semibold text-zinc-100"><ShieldCheck className="size-4 text-teal-400" />PCB sync safety preflight</div>
          <p className="mt-1 text-[11px] text-zinc-500">Preview only · Board unchanged · Stage 3 does not place or route</p>
        </div>
        <span className={`rounded px-2 py-1 text-[10px] font-semibold uppercase ${result.blockers.length ? "bg-red-950 text-red-300" : "bg-emerald-950 text-emerald-300"}`}>{result.status.replaceAll("_", " ")}</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Target" value={targetLabel} />
        <Stat label="Components" value={`${result.summary.layoutReadyComponents}/${result.summary.applicableComponents} ready`} />
        <Stat label="Nets" value={`${result.summary.totalNets - result.summary.blockedNets}/${result.summary.totalNets} ready`} />
      </div>

      <div className="mt-3 rounded border border-zinc-800 p-2">
        <div className="flex items-center justify-between"><span className="font-medium text-zinc-200">Exact plan</span><span>{result.plan?.operations.length ?? 0} operations</span></div>
        {operationsByRisk.length ? <div className="mt-2 flex flex-wrap gap-1.5">{operationsByRisk.map(({ risk, count }) => <span key={risk} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px]">{count} {risk.replaceAll("_", " ")}</span>)}</div> : <p className="mt-1 text-[11px] text-zinc-500">No board changes are proposed.</p>}
      </div>

      {result.blockers.length > 0 && <div className="mt-3 space-y-2" aria-label="Synchronization blockers">
        <div className="flex items-center gap-1.5 font-medium text-red-300"><AlertTriangle className="size-3.5" />All blockers ({result.blockers.length})</div>
        {result.blockers.map((blocker, index) => <div key={`${blocker.code}-${index}`} className="rounded border border-red-950 bg-red-950/20 p-2">
          <div className="font-mono text-[10px] text-red-300">{blocker.code}</div>
          <div className="mt-0.5 text-zinc-300">{blocker.message}</div>
          {(blocker.displayRefs.length > 0 || blocker.stableIds.length > 0) && <div className="mt-1 text-[10px] text-zinc-500">{blocker.displayRefs.join(", ")}{blocker.displayRefs.length > 0 && blocker.stableIds.length > 0 ? " · " : ""}{blocker.stableIds.join(", ")}</div>}
        </div>)}
      </div>}

      {canApply && <label className="mt-3 flex items-start gap-2 rounded border border-amber-900/60 bg-amber-950/20 p-2 text-[11px] text-amber-100">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmedPreflightId(event.target.checked ? result.preflightId : null)} className="mt-0.5" />
        Apply this exact plan and digest. This is separate from discussion and preview.
      </label>}
      <button type="button" disabled={!canApply || !confirmed || busy} onClick={() => result.plan && onApply?.(result.plan.planId, result.plan.planDigest)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded bg-teal-600 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500">
        {result.blockers.length ? <LockKeyhole className="size-3.5" /> : result.status === "ready_no_changes" ? <CheckCircle2 className="size-3.5" /> : <Route className="size-3.5" />}
        {busy ? "Applying exact plan…" : result.blockers.length ? "Apply disabled — resolve blockers" : result.status === "ready_no_changes" ? "Board already synchronized" : "Apply exact plan"}
      </button>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-zinc-900 p-2"><div className="text-[9px] uppercase tracking-wide text-zinc-600">{label}</div><div className="mt-0.5 truncate font-medium text-zinc-300" title={value}>{value}</div></div>;
}
