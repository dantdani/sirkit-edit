"use client";

/**
 * [PR-F fA] The "Missing parts" list: the Schematic -> PCB refusal rows (PcbEditor's SyncBlockersPanel, test ids kept:
 * `sync-unresolved-instances` / `sync-unresolved-<refDes>` / `data-missing`) grown into a WORKFLOW ITEM the user acts on without
 * reading a report. Each row keeps its missing fact and review path, and expands (per row, on click) into the missing-facts
 * checklist of app/lib/parts/missing-facts.ts - identity, evidence, stock and pricing kept apart, a Theory symbol "not a physical
 * part" - with the four next actions in F's order, each wired to what EXISTS:
 *  - Search catalog: `POST /api/parts/search` (the Build Library's catalog read), the first hits' published exact revision read
 *    from `GET /api/parts/[id]` (the Build Library's "Use published exact revision" source);
 *  - Search distributors: `POST /api/parts/external-search` with the bounded query; every source's state is shown in the Build
 *    Library's words - an unavailable, paused or refused source is that state, never a fake hit; the hits feed the checklist as
 *    sourcing observations (stock and pricing only);
 *  - Request review / Create unverified draft: the existing AtomicPublicationReviewSection (POST /api/components/atomic/publication
 *    submit_request) opened inline with the prefill; the person submits, a reviewer approves, a different administrator publishes;
 *    the draft prefill adds the symbol/footprint references - the request stays UNVERIFIED and not PCB-assignable until the
 *    deterministic mapping checks and the human publication pass. An action without its facts or its path is disabled with the
 *    reason (never a fake).
 * [PR-M, 2026-10-18] Above the rows, "Find a replacement in the library" (runbook M.1): for the listed catalog instances it starts the
 * SAME agent path a chat request takes - the page sends one sentence naming the references and their stable instance ids through the
 * existing composer route to the assistant, which inspects them, searches the local library and seals ONE resolution batch for the
 * human's review (the page's review dialog applies it). The button only hands the page the instances; it is disabled, with the reason,
 * when there is no catalog instance to resolve or the page offers no assistant.
 * Nothing here binds, publishes, buys or applies anything; the catalog part record comes from the page's parts cache.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeRefDes, schDisplayRef, type SchematicState } from "@/lib/schematic-types";
import { ensurePartLoaded, getCachedPart, subscribeToPart, type CachedPart } from "@/app/lib/parts-cache";
import { projectSelectorHeaders, type ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { EXTERNAL_SEARCH_MAX_LIMIT, type ExternalCandidateHit, type ExternalSearchResult } from "@/app/lib/acquisition/external-search-contract";
import { SERVED_FROM_WORDS } from "@/app/lib/acquisition/source-labels";
import { UNRESOLVED_MISSING_LABEL, type UnresolvedInstance } from "@/app/lib/pcb-sync/unresolved-instances";
import {
  deriveMissingFacts,
  externalSourceStateWords,
  MISSING_FACT_CLASS_LABEL,
  type CatalogPartFacts,
  type CatalogPartLoad,
  type MissingFactClass,
  type PublicationPrefill,
  type SourcingObservationFacts,
} from "@/app/lib/parts/missing-facts";
import { AtomicPublicationReviewSection, type AtomicPublicationPrefill } from "@/app/components/parts/AtomicPublicationReviewPanel";

const FACT_CLASSES: readonly MissingFactClass[] = ["identity", "evidence", "stock_pricing"];
const CATALOG_SEARCH_FAILED = "The catalog search could not be completed.";
const EXTERNAL_SEARCH_FAILED = "The distributor search could not be completed.";
/** The catalog hits whose published exact revision is read (one GET /api/parts/[id] each). */
const CATALOG_HITS = 5;

type ExternalSearchAnswer = Extract<ExternalSearchResult, { ok: true }>;
interface CatalogHit { id: string; name: string; mpn: string | null; manufacturer: string | null; published: "yes" | "no" | "unknown"; revisionId: string | null }

/** The parts cache's record as the checklist reads it. */
function catalogFactsOf(part: CachedPart): CatalogPartFacts {
  return {
    id: part.id, name: part.name, mpn: part.mpn, manufacturer: part.manufacturer, libraryName: part.libraryName, footprintHint: part.footprintHint,
    pinCount: part.pins.length, hasSymbol: part.symbolRaw.length > 0,
    ...(part.atomicAssignments ? { atomicAssignments: part.atomicAssignments } : {}),
    ...(part.withdrawnValueKeys ? { withdrawnValueKeys: part.withdrawnValueKeys } : {}),
  };
}

/** The catalog part record of a KiCad instance through the page's parts cache (loaded / loading / unavailable); `none` without a part id. */
function useCatalogPart(partId: string | null): CatalogPartLoad {
  const [failure, setFailure] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!partId) return;
    const unsubscribe = subscribeToPart(partId, () => setTick((n) => n + 1));
    if (!getCachedPart(partId)) ensurePartLoaded(partId).then(() => setTick((n) => n + 1), (error: unknown) => setFailure(error instanceof Error ? error.message : "the part could not be read"));
    return unsubscribe;
  }, [partId]);
  return useMemo<CatalogPartLoad>(() => {
    void tick;
    if (!partId) return { state: "none" };
    const cached = getCachedPart(partId);
    if (cached) return { state: "loaded", part: catalogFactsOf(cached) };
    return failure ? { state: "unavailable", reason: failure } : { state: "loading" };
  }, [partId, failure, tick]);
}

const sourcingOf = (hit: ExternalCandidateHit): SourcingObservationFacts => ({ sourceDisplayName: hit.sourceDisplayName, mpn: hit.mpn, exactMatch: hit.exactMatch, manufacturer: hit.manufacturer, stock: hit.stock, priceBreaks: hit.priceBreaks.length, servedFrom: hit.servedFrom });

const toPanelPrefill = (prefill: PublicationPrefill, draft: boolean): AtomicPublicationPrefill => ({
  ...(prefill.exactMpn ? { exactMpn: prefill.exactMpn } : {}),
  manufacturer: prefill.manufacturer,
  partId: prefill.partId,
  // the review names the part; the draft also names the symbol and footprint by reference (the server assembles it)
  symbol: draft ? prefill.symbol : null,
  footprint: draft ? prefill.footprint : null,
});

const STATE_CLASS: Readonly<Record<"known" | "unknown" | "conflicting", string>> = { known: "text-emerald-300", unknown: "text-zinc-400", conflicting: "text-amber-300" };

/** [PR-M, 2026-10-18] The instances "Find a replacement in the library" hands the page: the listed CATALOG instances (a Theory symbol is
 *  resolved by placing a catalog part, never by a replacement of the same instance), by stable id and reference. */
export interface ReplacementRequestInstance { componentId: string; refDes: string }
export const FIND_REPLACEMENT_LABEL = "Find a replacement in the library";

export function MissingPartsList({ items, schematic, projectScope, onFindReplacement }: { items: readonly UnresolvedInstance[]; schematic: SchematicState; projectScope: ProjectSelectorScope | null; /** [PR-M, 2026-10-18] the page's agent entry point (absent: no assistant on this surface) */ onFindReplacement?: (instances: ReplacementRequestInstance[]) => void }) {
  const catalogInstances = useMemo(() => items.flatMap((item): ReplacementRequestInstance[] => {
    if (item.family !== "kicad") return [];
    const instance = (schematic.kicadComponents ?? []).find((candidate) => candidate.refDes === item.refDes);
    return instance ? [{ componentId: instance.id, refDes: instance.refDes }] : [];
  }), [items, schematic]);
  const findReason = !onFindReplacement ? "the assistant is not available on this surface" : catalogInstances.length === 0 ? "no listed instance is a catalog part (a Theory symbol needs a catalog part placed instead)" : null;
  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <button type="button" onClick={() => { if (onFindReplacement && catalogInstances.length > 0) onFindReplacement(catalogInstances); }} disabled={findReason !== null} aria-describedby="missing-find-replacement-note" data-testid="missing-parts-find-replacement" data-count={catalogInstances.length} className="rounded border border-teal-800 px-2 py-0.5 text-teal-200 hover:border-teal-600 disabled:cursor-not-allowed disabled:opacity-50">{FIND_REPLACEMENT_LABEL}</button>
        <span id="missing-find-replacement-note" className="text-zinc-400">{findReason ? `not available: ${findReason}` : `asks the assistant to inspect ${catalogInstances.map((instance) => instance.refDes).join(", ")}, search the local library and prepare one batch for your review - nothing changes until you approve it`}</span>
      </div>
      <ul data-testid="sync-unresolved-instances" aria-label="Unresolved instances" className="mt-2 space-y-1.5">
        {items.map((item) => <MissingPartRow key={`${item.family}:${item.refDes}`} item={item} schematic={schematic} projectScope={projectScope} />)}
      </ul>
    </>
  );
}

function MissingPartRow({ item, schematic, projectScope }: { item: UnresolvedInstance; schematic: SchematicState; projectScope: ProjectSelectorScope | null }) {
  const [expanded, setExpanded] = useState(false);
  const [catalogHits, setCatalogHits] = useState<CatalogHit[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [external, setExternal] = useState<ExternalSearchAnswer | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [externalBusy, setExternalBusy] = useState(false);
  const [publication, setPublication] = useState<{ kind: "review" | "draft"; prefill: AtomicPublicationPrefill } | null>(null);

  // the instance's own facts: a KiCad instance by its reference, a Theory component by its displayed reference
  const kicad = item.family === "kicad" ? (schematic.kicadComponents ?? []).find((instance) => instance.refDes === item.refDes) ?? null : null;
  const theory = item.family === "theory" ? schematic.components.find((component) => normalizeRefDes(schDisplayRef(component)) === item.refDes) ?? null : null;
  const catalog = useCatalogPart(kicad?.partId ?? null);
  const sourcing = useMemo(() => (external?.hits ?? []).map(sourcingOf), [external]);
  const checklist = useMemo(() => deriveMissingFacts({
    instance: item,
    schematic: { value: kicad?.value ?? theory?.value ?? null, partId: kicad?.partId ?? null, atomicPartRevisionId: kicad?.atomicPartRevisionId ?? null, symbolAssetVersionId: kicad?.symbolAssetVersionId ?? null, theoryType: theory?.type ?? null },
    catalog,
    sourcing,
    projectOpen: projectScope !== null,
  }), [item, kicad, theory, catalog, sourcing, projectScope]);

  // (1) the published local catalog: the Build Library's search, then each hit's published exact revision from its detail
  const searchCatalog = useCallback(async () => {
    const action = checklist.actions.find((candidate) => candidate.id === "search_catalog");
    if (!action || action.availability.state !== "available" || catalogBusy) return;
    setCatalogBusy(true);
    setCatalogError(null);
    try {
      const res = await fetch("/api/parts/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: action.availability.query, offset: 0, limit: CATALOG_HITS }) });
      const data = (await res.json()) as { ok: boolean; results?: Array<{ id: string; name: string; mpn: string | null; manufacturer: string | null }>; error?: unknown };
      if (!data.ok || !Array.isArray(data.results)) throw new Error(typeof data.error === "string" ? data.error.slice(0, 200) : CATALOG_SEARCH_FAILED);
      const hits = await Promise.all(data.results.slice(0, CATALOG_HITS).map(async (hit): Promise<CatalogHit> => {
        try {
          const detail = (await (await fetch(`/api/parts/${encodeURIComponent(hit.id)}`)).json()) as { ok: boolean; part?: { atomicAssignments?: Record<string, { revisionId: string }> } | null };
          const assignments = detail.ok && detail.part?.atomicAssignments ? Object.values(detail.part.atomicAssignments) : null;
          return { id: hit.id, name: hit.name, mpn: hit.mpn ?? null, manufacturer: hit.manufacturer ?? null, published: assignments === null ? (detail.ok ? "no" : "unknown") : assignments.length > 0 ? "yes" : "no", revisionId: assignments?.[0]?.revisionId ?? null };
        } catch {
          return { id: hit.id, name: hit.name, mpn: hit.mpn ?? null, manufacturer: hit.manufacturer ?? null, published: "unknown", revisionId: null };
        }
      }));
      setCatalogHits(hits);
    } catch (error) {
      setCatalogHits(null);
      setCatalogError(error instanceof Error && error.message ? error.message : CATALOG_SEARCH_FAILED);
    } finally {
      setCatalogBusy(false);
    }
  }, [checklist, catalogBusy]);

  // (2) the admitted distributors: the server decides what is live; the body is the bounded query, the mode and the limit
  const searchDistributors = useCallback(async () => {
    const action = checklist.actions.find((candidate) => candidate.id === "search_distributors");
    if (!action || action.availability.state !== "available" || !projectScope || externalBusy) return;
    setExternalBusy(true);
    setExternalError(null);
    try {
      const res = await fetch("/api/parts/external-search", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...projectSelectorHeaders(projectScope) },
        body: JSON.stringify({ query: action.availability.query, mode: action.availability.mode ?? "keyword", limit: EXTERNAL_SEARCH_MAX_LIMIT }),
      });
      const data = (await res.json()) as ExternalSearchResult | { ok: false; code?: string; error?: unknown };
      if (data.ok) setExternal(data);
      else { setExternal(null); setExternalError(`${typeof data.error === "string" ? data.error.slice(0, 200) : EXTERNAL_SEARCH_FAILED}${"code" in data && data.code ? ` (${data.code})` : ""}`); }
    } catch {
      setExternal(null);
      setExternalError(EXTERNAL_SEARCH_FAILED);
    } finally {
      setExternalBusy(false);
    }
  }, [checklist, projectScope, externalBusy]);

  // (3) and (4): the existing publication request, opened with the prefill; nothing is requested until the person submits it
  const openPublicationRequest = useCallback((kind: "review" | "draft") => {
    const action = checklist.actions.find((candidate) => candidate.id === (kind === "review" ? "request_review" : "create_draft"));
    if (!action || action.availability.state !== "available" || !checklist.publicationPrefill) return;
    setPublication({ kind, prefill: toPanelPrefill(checklist.publicationPrefill, kind === "draft") });
  }, [checklist]);

  const ref = item.refDes;
  const checklistId = `missing-checklist-${ref}`;
  return (
    <li data-testid={`sync-unresolved-${ref}`} data-missing={item.missing} data-physical={checklist.physical ? "true" : "false"} className="rounded border border-red-950 bg-red-950/20 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div><span className="font-mono text-zinc-100">{ref}</span><span className="text-red-200"> — {UNRESOLVED_MISSING_LABEL[item.missing]}</span></div>
          <div className="mt-0.5 text-[11px] text-zinc-400">Review path: {item.reviewPath}</div>
        </div>
        <button type="button" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded} aria-controls={checklistId} aria-label={`${expanded ? "Hide" : "Show"} the missing-facts checklist for ${ref}`} data-testid={`missing-checklist-toggle-${ref}`} className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:border-zinc-500">
          {expanded ? "Hide checklist" : "Checklist"}
        </button>
      </div>
      {expanded && (
        <div id={checklistId} data-testid={checklistId} className="mt-2 space-y-2 border-t border-red-950/60 pt-2">
          <p data-testid={`missing-headline-${ref}`} className={checklist.physical ? "text-zinc-200" : "text-amber-200"}>{checklist.headline}</p>
          <dl className="grid gap-1.5">
            {FACT_CLASSES.map((cls) => (
              <div key={cls} data-testid={`missing-class-${ref}-${cls}`} className="rounded border border-zinc-800 bg-zinc-950/60 p-1.5">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{MISSING_FACT_CLASS_LABEL[cls]}{cls === "stock_pricing" ? <span className="normal-case tracking-normal"> — {checklist.sourcingRule}</span> : null}</dt>
                {checklist.facts.filter((fact) => fact.cls === cls).map((fact) => (
                  <dd key={fact.id} data-testid={`missing-fact-${ref}-${fact.id}`} data-state={fact.state} data-class={fact.cls} className="mt-0.5 grid grid-cols-[7rem_1fr] gap-x-2 text-[11px]">
                    <span className="text-zinc-300">{fact.label}</span>
                    <span className="min-w-0">
                      <span className={`${STATE_CLASS[fact.state]} font-medium`}>{fact.state}</span>
                      {fact.value ? <span className="text-zinc-100"> · {fact.value}</span> : null}
                      <span className="block text-zinc-500">{fact.source}{fact.note ? ` — ${fact.note}` : ""}</span>
                    </span>
                  </dd>
                ))}
              </div>
            ))}
          </dl>
          <ol aria-label={`Next actions for ${ref}`} className="grid gap-1">
            {checklist.actions.map((action) => {
              const availability = action.availability;
              const available = availability.state === "available";
              const busy = action.id === "search_catalog" ? catalogBusy : action.id === "search_distributors" ? externalBusy : false;
              const run = action.id === "search_catalog" ? () => void searchCatalog() : action.id === "search_distributors" ? () => void searchDistributors() : action.id === "request_review" ? () => openPublicationRequest("review") : () => openPublicationRequest("draft");
              return (
                <li key={action.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <span className="w-3 text-zinc-500">{action.order}.</span>
                  <button type="button" onClick={run} disabled={!available || busy} title={availability.state === "available" ? action.note : availability.reason} data-testid={`missing-action-${ref}-${action.id}`} data-available={available ? "true" : "false"} className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-100 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? `${action.label}…` : action.label}
                  </button>
                  {availability.state === "available"
                    ? <span className="text-zinc-500">{availability.query ? `“${availability.query}”${availability.mode ? ` · ${availability.mode}` : ""} · ` : ""}{action.note}</span>
                    : <span data-testid={`missing-action-reason-${ref}-${action.id}`} className="text-zinc-400">not available: {availability.reason}</span>}
                </li>
              );
            })}
          </ol>
          {(catalogHits || catalogError) && (
            <div data-testid={`missing-catalog-${ref}`} className="rounded border border-zinc-800 bg-zinc-950/60 p-1.5 text-[11px]">
              <div className="text-zinc-400">Catalog search — the first {CATALOG_HITS} parts and whether a published exact revision links each (place one from the Build Library: Use published exact revision)</div>
              {catalogError && <div className="text-amber-300" role="alert">{catalogError}</div>}
              {catalogHits && catalogHits.length === 0 && <div className="text-zinc-500">No catalog part matched.</div>}
              {catalogHits?.map((hit) => (
                <div key={hit.id} data-testid="missing-catalog-hit" data-published={hit.published} className="mt-0.5 flex flex-wrap gap-x-2">
                  <span className="text-zinc-100">{hit.name}</span>
                  {hit.mpn && <span className="font-mono text-zinc-300">{hit.mpn}</span>}
                  {hit.manufacturer && <span className="text-zinc-400">{hit.manufacturer}</span>}
                  <span className={hit.published === "yes" ? "text-emerald-300" : "text-zinc-400"}>{hit.published === "yes" ? `published exact revision ${hit.revisionId ?? ""}` : hit.published === "no" ? "no published exact revision" : "published revision unknown (detail unreadable)"}</span>
                </div>
              ))}
            </div>
          )}
          {(external || externalError) && (
            <div data-testid={`missing-external-${ref}`} className="rounded border border-zinc-800 bg-zinc-950/60 p-1.5 text-[11px]">
              <div className="text-zinc-400">Distributor search — {external ? `“${external.query}” · ${external.mode} · ${external.authority}` : "no answer"}</div>
              {externalError && <div className="text-amber-300" role="alert">{externalError}</div>}
              {external && (
                <>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {external.sources.map((source) => (
                      <span key={source.sourceId} data-testid={`missing-source-${ref}-${source.sourceId}`} data-status={source.status} data-served-from={source.servedFrom ?? "none"} title={source.attribution} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                        {source.displayName} · {externalSourceStateWords(source)}
                      </span>
                    ))}
                  </div>
                  {external.hits.length === 0
                    ? <div className="mt-0.5 text-zinc-500">No sourcing observation: no admitted source answered.</div>
                    : external.hits.map((hit) => (
                      <div key={`${hit.sourceId}:${hit.observationId}:${hit.mpn}`} data-testid="missing-hit" className="mt-0.5 flex flex-wrap gap-x-2">
                        <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-300">{hit.sourceDisplayName}</span>
                        <span className="font-mono text-zinc-100">{hit.mpn}</span>
                        {!hit.exactMatch && <span className="text-amber-300">not an exact match</span>}
                        {hit.manufacturer && <span className="text-zinc-400">{hit.manufacturer} (spelling: a hint)</span>}
                        <span className="text-zinc-400">stock {hit.stock ?? "—"} · {hit.priceBreaks.length} price break{hit.priceBreaks.length === 1 ? "" : "s"} · {SERVED_FROM_WORDS[hit.servedFrom]}</span>
                      </div>
                    ))}
                </>
              )}
            </div>
          )}
          {publication && projectScope && (
            <div data-testid={`missing-review-${ref}`} data-kind={publication.kind} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-zinc-400">{publication.kind === "draft" ? "Unverified draft: a publication request with the symbol and footprint named by reference — not PCB-assignable until the mapping checks and the human publication pass" : "Review handoff: a person requests, a reviewer approves, a different administrator publishes"}</span>
                <button type="button" onClick={() => setPublication(null)} aria-label={`Close the publication request for ${ref}`} data-testid={`missing-review-close-${ref}`} className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500">Close</button>
              </div>
              <AtomicPublicationReviewSection key={`${publication.kind}:${publication.prefill.exactMpn ?? ""}:${publication.prefill.partId ?? ""}`} projectScope={projectScope} prefill={publication.prefill} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
