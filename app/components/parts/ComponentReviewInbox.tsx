"use client";

/**
 * [PR-M, 2026-10-18] Section M2 (design M2.4): the catalog governance project's COMPONENT REVIEW INBOX in the Build Library - the
 * acquisition handoffs a person sent for review (GET /api/parts/acquisitions?inbox=1, answered ONLY in the configured governance
 * project; in any other project, or with no governance configured, the inbox renders nothing). Each row shows what the task retrieved and
 * validated - the source (FIXTURE evidence named as such), the identity (an exact MPN only with real evidence, otherwise a GENERIC KiCad
 * candidate), the stored objects' hashes, the licence, the validation verdict and every unresolved fact or conflict - and opens the
 * EXISTING publication review (AtomicPublicationReviewPanel) prefilled with the package: a person requests, a reviewer approves, a
 * different administrator publishes. Nothing here approves or publishes anything.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { projectSelectorHeaders, type ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { CAD_ACQUISITION_ROUTE, cadCandidateIdentityLine } from "@/app/lib/acquisition/cad-acquisition-contract";
import type { AtomicPublicationLink, AtomicPublicationSpec } from "@/app/lib/atomic/publication-review-contract";
import type { AtomicPublicationPrefill } from "./AtomicPublicationReviewPanel";

/** The inbox row as the route answers it (the handoff record's public fields). */
interface InboxHandoff {
  handoffId: string;
  createdAt: string;
  requester: { principalId: string };
  sourceId: string;
  fixtureEvidence: boolean;
  target: { catalogPartId: string; catalogMpn: string | null; symbol: { library: string; name: string }; footprint: { library: string; name: string } | null; exactMpn: string | null; valueKey: string };
  objects: Array<{ role: string; sha256: string; byteLength: number }>;
  report: { verdict: string; identity: { kind: "exact" | "generic"; exactMpn: string | null; basis: string } };
  licence: { attribution: string; record: { id: string; spdxId?: string | null } };
  package: { spec: AtomicPublicationSpec; links: AtomicPublicationLink[]; discovery: boolean; missing: string[]; conflicts: string[]; notes: string[] };
}

export function handoffPrefill(handoff: InboxHandoff): AtomicPublicationPrefill {
  return {
    exactMpn: handoff.package.spec.exactMpn,
    symbol: handoff.package.spec.symbol,
    footprint: handoff.package.spec.footprint,
    manufacturer: handoff.package.spec.manufacturer?.canonicalName ?? null,
    acquisition: {
      handoffId: handoff.handoffId, spec: handoff.package.spec, links: handoff.package.links,
      discovery: handoff.package.discovery, // [PR-L/M integration, 2026-10-18] M2-SEC-5: a flag; the server decides the discovery row's value key
      notes: handoff.package.notes, missing: handoff.package.missing, conflicts: handoff.package.conflicts,
    },
  };
}

export function ComponentReviewInbox({ projectScope, onOpen }: { projectScope: ProjectSelectorScope | null; onOpen: (prefill: AtomicPublicationPrefill) => void }) {
  const [loaded, setLoaded] = useState<{ key: string; handoffs: InboxHandoff[] | null } | null>(null);
  const scopeKey = projectScope ? `${projectScope.tenantId}/${projectScope.projectId}/${projectScope.branchId}` : "";
  const scopeRef = useRef(projectScope);
  useEffect(() => { scopeRef.current = projectScope; }, [projectScope]);
  const load = useCallback(async (scope: ProjectSelectorScope, key: string) => {
    let handoffs: InboxHandoff[] | null = null;
    try {
      const response = await fetch(`${CAD_ACQUISITION_ROUTE}?inbox=1`, { headers: projectSelectorHeaders(scope), cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; handoffs?: InboxHandoff[] };
      handoffs = body.ok === true && Array.isArray(body.handoffs) ? body.handoffs : null;
    } catch {
      handoffs = null;
    }
    setLoaded({ key, handoffs });
  }, []);
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope || scopeKey === "") return;
    void load(scope, scopeKey);
  }, [scopeKey, load]);
  const handoffs = loaded && loaded.key === scopeKey ? loaded.handoffs : null;
  if (!projectScope || handoffs === null) return null; // not the governance project (or none configured): no inbox
  return (
    <section aria-label="Component review inbox" data-testid="component-review-inbox" data-count={handoffs.length} className="p-2 border-b border-zinc-800 space-y-1 text-[11px] text-zinc-300">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-zinc-100">Component review inbox</span>
        <button type="button" onClick={() => void load(projectScope, scopeKey)} data-testid="component-review-inbox-refresh" className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500">Refresh</button>
      </div>
      {handoffs.length === 0 && <div className="text-zinc-500">No acquired part is waiting for review.</div>}
      <ul className="grid gap-1">
        {handoffs.map((handoff) => (
          <li key={handoff.handoffId} data-testid={`component-review-handoff-${handoff.handoffId}`} data-identity={handoff.report.identity.kind} data-fixture={handoff.fixtureEvidence ? "true" : "false"} className="rounded border border-zinc-800 bg-zinc-950/60 p-1.5">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="font-mono text-zinc-100">{handoff.package.spec.exactMpn}</span>
              <span className="text-zinc-400">{handoff.target.symbol.library}:{handoff.target.symbol.name}{handoff.target.footprint ? ` · ${handoff.target.footprint.library}:${handoff.target.footprint.name}` : ""}</span>
              <span className={handoff.report.verdict === "validated" ? "text-emerald-300" : "text-amber-300"}>{handoff.report.verdict}</span>
            </div>
            <div data-testid="component-review-identity" className="text-zinc-400">{cadCandidateIdentityLine(handoff.report.identity)}</div>{/* [PR-L/M integration, 2026-10-18] the kind named once */}
            <div className="text-zinc-500">source {handoff.sourceId}{handoff.fixtureEvidence ? " (FIXTURE evidence)" : ""} · licence {handoff.licence.record.spdxId ?? handoff.licence.record.id} · sent by {handoff.requester.principalId}</div>
            <div className="text-zinc-500">{handoff.objects.map((object) => `${object.role} sha256:${object.sha256.slice(0, 12)}…`).join(" · ")}</div>
            {handoff.package.missing.length > 0 && <div className="text-amber-300">Still to confirm: {handoff.package.missing.join("; ")}</div>}
            <button type="button" onClick={() => onOpen(handoffPrefill(handoff))} aria-label={`Open the publication review for ${handoff.package.spec.exactMpn}`} data-testid={`component-review-open-${handoff.handoffId}`} className="mt-0.5 rounded border border-sky-800 px-2 py-0.5 text-sky-200 hover:border-sky-600">Open in the publication review</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
