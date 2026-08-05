"use client";

import { AlertTriangle, CheckCircle2, GitBranch, Layers3, LockKeyhole, ShieldCheck } from "lucide-react";
import type { MappingContext, MappingVerificationResult } from "@/app/lib/mapping-verification/types";

function coverageLabel(result: MappingVerificationResult, layer: "symbol" | "terminal" | "pad"): string {
  const value = layer === "symbol" ? result.symbolCoverage : layer === "terminal" ? result.packageTerminalCoverage : result.footprintPadCoverage;
  return `${value.accounted}/${value.required} (${value.coveragePercent}%)`;
}

export function MappingVerificationPanel({
  result,
  context,
  busy = false,
  onVerify,
}: {
  result?: MappingVerificationResult;
  context?: MappingContext;
  busy?: boolean;
  onVerify?: () => void;
}) {
  const verified = result?.status === "verified" || result?.status === "verified_limited";
  const findingCount = result?.findings.length ?? 0;
  return (
    <section aria-label="Pin and pad mapping verification" className="rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs text-zinc-300">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 font-semibold text-zinc-100"><Layers3 className="size-4 text-teal-400" />Pin-pad mapping verification</div>
          <p className="mt-1 text-[11px] text-zinc-500">Read-only check · Does not approve a mapping · Schematic and PCB unchanged</p>
        </div>
        <span className={`rounded px-2 py-1 text-[10px] font-semibold uppercase ${verified ? "bg-emerald-950 text-emerald-300" : result ? "bg-amber-950 text-amber-300" : "bg-zinc-900 text-zinc-400"}`}>
          {result?.status.replaceAll("_", " ") ?? "not verified"}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Three mapping layers">
        <LayerCard label="1 · Logical symbol pins" count={context?.symbolPins.length} coverage={result ? coverageLabel(result, "symbol") : undefined} />
        <LayerCard label="2 · Package terminals" count={context?.packageTerminals.length} coverage={result ? coverageLabel(result, "terminal") : undefined} />
        <LayerCard label="3 · Exact footprint pads" count={context?.footprintPads.length} coverage={result ? coverageLabel(result, "pad") : undefined} />
      </div>

      {result && <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Tier" value={result.tier?.replaceAll("_", " ") ?? "none"} />
        <Stat label="Findings" value={String(findingCount)} />
        <Stat label="Approval" value={result.claims.approvesMapping ? "approved" : "separate review"} />
      </div>}

      {result?.findings.length ? <div className="mt-3 space-y-2" aria-label="All mapping findings">
        <div className="flex items-center gap-1.5 font-medium text-amber-300"><AlertTriangle className="size-3.5" />All findings ({result.findings.length})</div>
        {result.findings.map((item) => <div key={item.findingId} className={`rounded border p-2 ${item.blocking ? "border-red-950 bg-red-950/20" : "border-zinc-800 bg-zinc-900/40"}`}>
          <div className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] text-red-300">{item.code}</span><span className="text-[9px] uppercase text-zinc-500">{item.layer.replaceAll("_", " ")}</span></div>
          <div className="mt-0.5 text-zinc-300">{item.message}</div>
          {[...item.symbolPinIds, ...item.packageTerminalIds, ...item.footprintPadIds].length > 0 && <div className="mt-1 break-all font-mono text-[9px] text-zinc-500">{[...item.symbolPinIds, ...item.packageTerminalIds, ...item.footprintPadIds].join(", ")}</div>}
        </div>)}
      </div> : result && <div className="mt-3 flex items-center gap-1.5 rounded border border-emerald-950 bg-emerald-950/20 p-2 text-emerald-300"><CheckCircle2 className="size-3.5" />No verification findings in the supported profile.</div>}

      {result?.conflicts.length ? <div className="mt-3 rounded border border-red-950 p-2 text-red-300"><GitBranch className="mr-1 inline size-3.5" />{result.conflicts.length} explicit evidence or identity conflict(s)</div> : null}
      {result?.status === "verified_limited" && <div className="mt-3 flex gap-1.5 rounded border border-amber-900 bg-amber-950/20 p-2 text-amber-200"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />Limited direct-pair verification is not accepted for PCB layout readiness.</div>}

      <button type="button" disabled={busy || !onVerify} onClick={onVerify} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded bg-teal-600 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500">
        <ShieldCheck className="size-3.5" />{busy ? "Verifying…" : "Verify mapping (read only)"}
      </button>
    </section>
  );
}

function LayerCard({ label, count, coverage }: { label: string; count?: number; coverage?: string }) {
  return <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2"><div className="text-[10px] font-medium text-zinc-200">{label}</div><div className="mt-1 text-[11px] text-zinc-500">{count === undefined ? "Not loaded" : `${count} item${count === 1 ? "" : "s"}`}</div>{coverage && <div className="mt-1 font-mono text-[10px] text-teal-400">{coverage}</div>}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-zinc-900 p-2"><div className="text-[9px] uppercase tracking-wide text-zinc-600">{label}</div><div className="mt-0.5 truncate font-medium text-zinc-300" title={value}>{value}</div></div>;
}
