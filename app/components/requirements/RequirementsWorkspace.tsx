"use client";

import { useMemo, useState } from "react";
import type { DesignRequirementsPackage, RequirementDomain } from "@/app/lib/requirements/types";

const STATUS_LABELS: Record<DesignRequirementsPackage["status"], string> = {
  draft: "Draft",
  awaiting_clarification: "Awaiting clarification",
  awaiting_approval: "Awaiting approval",
  blocked_by_contradiction: "Blocked by contradiction",
  blocked_by_unsupported_capability: "Blocked by unsupported capability",
  accepted_for_architecture_exploration: "Accepted for architecture exploration",
  superseded: "Superseded",
  stale: "Stale",
};

export function RequirementsWorkspace({ value, onSelectRequirement }: { value: DesignRequirementsPackage; onSelectRequirement?: (requirementId: string) => void }) {
  const [domain, setDomain] = useState<RequirementDomain | "all">("all");
  const [query, setQuery] = useState("");
  const domains = useMemo(() => [...new Set(value.requirements.map((item) => item.domain))].sort(), [value.requirements]);
  const requirements = useMemo(() => value.requirements.filter((item) => (domain === "all" || item.domain === domain) && `${item.title} ${item.normalizedStatement} ${item.requirementId}`.toLowerCase().includes(query.toLowerCase())).sort((left, right) => right.priority - left.priority || left.requirementId.localeCompare(right.requirementId)), [domain, query, value.requirements]);
  const blockers = value.openQuestions.filter((item) => item.status === "open" && (item.blockingLevel === "before_package_acceptance" || item.blockingLevel === "before_architecture"));
  return <section aria-label="Requirements workspace" className="flex h-full min-h-0 flex-col bg-[#0d1015] text-slate-100">
    <header className="border-b border-slate-800 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs uppercase tracking-widest text-cyan-400">Requirements contract</p><h1 className="text-lg font-semibold">{value.title}</h1><p className="mt-1 text-xs text-slate-400">{value.packageId} · revision {value.revision}</p></div>
        <div className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-right"><p className="text-xs text-slate-400">Package status</p><p className="text-sm font-medium">{STATUS_LABELS[value.status]}</p></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
        <Axis label="Confirmed" value={`${value.requirements.filter((item) => item.status === "confirmed").length}/${value.requirements.length}`} />
        <Axis label="Unsupported" value={String(value.requirements.filter((item) => item.capabilityAssessment.state === "unsupported").length)} />
        <Axis label="Questions" value={String(value.openQuestions.filter((item) => item.status === "open").length)} />
        <Axis label="Blocking" value={String(blockers.length)} />
        <Axis label="Evidence passed" value="0 (planned only)" />
      </div>
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-h-0 overflow-auto p-4">
        <div className="mb-3 flex gap-2"><input aria-label="Search requirements" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requirements" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" /><select aria-label="Filter by domain" value={domain} onChange={(event) => setDomain(event.target.value as RequirementDomain | "all")} className="rounded border border-slate-700 bg-slate-950 px-2 text-sm"><option value="all">All domains</option>{domains.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></div>
        <div className="space-y-2">{requirements.map((item) => <button type="button" key={item.requirementId} onClick={() => onSelectRequirement?.(item.requirementId)} className="block w-full rounded border border-slate-800 bg-slate-900 p-3 text-left hover:border-cyan-800">
          <div className="flex justify-between gap-3"><strong className="text-sm">{item.title}</strong><span className="text-xs text-slate-400">{item.status.replaceAll("_", " ")}</span></div>
          <p className="mt-1 text-xs leading-5 text-slate-300">{item.normalizedStatement}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400"><span>{item.domain.replaceAll("_", " ")}</span><span>· {item.strength.replaceAll("_", " ")}</span><span>· {item.capabilityAssessment.state.replaceAll("_", " ")}</span><span>· verification {item.verificationPlanRefs.length ? "planned" : "missing"}</span></div>
        </button>)}</div>
      </div>
      <aside className="min-h-0 overflow-auto border-l border-slate-800 p-4">
        <Panel title="Assumption ledger" count={value.assumptions.length}>{value.assumptions.map((item) => <Entry key={item.assumptionId} title={item.statement} detail={`${item.riskClass} · ${item.status.replaceAll("_", " ")}`} />)}</Panel>
        <Panel title="Blocking questions" count={blockers.length}>{blockers.slice(0, 8).map((item) => <Entry key={item.questionId} title={item.text} detail={`score ${item.priorityScoreBreakdown.total} · ${item.whyItMatters}`} />)}</Panel>
        <Panel title="Conflicts" count={value.conflicts.filter((item) => item.status === "open").length}>{value.conflicts.filter((item) => item.status === "open").map((item) => <Entry key={item.conflictId} title={item.explanation} detail={`${item.severity} · ${item.conflictKind.replaceAll("_", " ")}`} />)}</Panel>
      </aside>
    </div>
  </section>;
}

function Axis({ label, value }: { label: string; value: string }) { return <div className="rounded bg-slate-900 p-2"><span className="block text-slate-500">{label}</span><strong>{value}</strong></div>; }
function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <section className="mb-5"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title} ({count})</h2><div className="space-y-2">{children}</div></section>; }
function Entry({ title, detail }: { title: string; detail: string }) { return <div className="rounded border border-slate-800 bg-slate-900 p-2"><p className="text-xs font-medium">{title}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>; }
