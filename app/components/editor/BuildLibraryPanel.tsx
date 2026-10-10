"use client";

/**
 * Build mode's parts catalog (Phase 2A — discovery only, no canvas placement).
 *
 * Flow: category list → drill into a category → browse/search parts → click a
 * part to open a floating preview with the rendered KiCad symbol + metadata.
 * Self-contained: manages its own state and data fetching; no props needed yet.
 *
 * [B19-E E2] "Search distributors": a member's bounded search of the enabled distributors by exact MPN or keyword. Every
 * hit is a labelled sourcing observation (source, served from, observed, expires, exact match) and never engineering
 * authority, so an external hit has no Place control; it is a lead for review, not a part on the canvas.
 *
 * [B19-E E4] "Request evidence review" (a part preview with an MPN, or an exact external hit) opens the atomic publication
 * review for that exact MPN: a bundle proves nothing, and only a published atomic revision controls schematic/PCB.
 *
 * [B19-E E5] "Use published exact revision" (a part preview whose value has a selectable atomic link) starts a placement that
 * adopts that exact identity, resolved as Build auto-layout resolves it; binding it stays a reviewer's act downstream.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Plus,
  ExternalLink,
  Loader2,
  Package,
  RotateCw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { KicadSymbol } from "@/app/components/schematic/KicadSymbol";
import type { KicadPin } from "@/app/lib/kicad/types";
import { DatasheetLink } from "@/app/components/parts/DatasheetLink"; // [B19-D I5c row 34, review]
import { AtomicPublicationReviewSection, type AtomicPublicationPrefill } from "@/app/components/parts/AtomicPublicationReviewPanel"; // [B19-E E4]
import { adoptPublishedExactRevision, type AdoptedAtomicIdentity } from "@/lib/build-auto-layout"; // [B19-E E5]
import type { CachedPart } from "@/app/lib/parts-cache";
import { projectSelectorHeaders, type ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { safeHref, VENDOR_PAGE_HOSTS } from "@/app/lib/net/href-policy";
import { SERVED_FROM_WORDS, utcMinute } from "@/app/lib/acquisition/source-labels"; // [B19-E E2]
import {
  EXTERNAL_OBSERVATION_AUTHORITY,
  EXTERNAL_SEARCH_MAX_LIMIT,
  EXTERNAL_SEARCH_MAX_QUERY_LENGTH,
  type ExternalCandidateHit,
  type ExternalSearchMode,
  type ExternalSearchResult,
  type ExternalSearchSourceStatus,
} from "@/app/lib/acquisition/external-search-contract";

// ─── Shapes returned by the parts APIs ──────────────────────────────────────

type Category = { mainCategory: string; partCount: number };

type PartSummary = {
  id: string;
  name: string;
  description: string | null;
  keywords: string | null;
  mpn: string | null;
  manufacturer: string | null;
  datasheet: string | null;
  mainCategory: string;
  libraryName: string;
  pinCount: number;
  score: number;
};

type PartDetail = {
  id: string;
  name: string;
  description: string | null;
  keywords: string | null;
  mpn: string | null;
  manufacturer: string | null;
  datasheet: string | null;
  footprintHint: string | null;
  mainCategory: string;
  libraryName: string;
  pins: KicadPin[];
  symbolRaw: string;
  properties: Record<string, string>;
  atomicCompatibility?: {
    revision: { publicationState: string };
    unresolved: string[];
  };
  /** [B19-E E4 review] the part's selectable atomic links by value key ('' is the default link) */
  atomicAssignments?: CachedPart["atomicAssignments"];
  /** [B19-E E4 review follow-up] value keys whose link points at a withdrawn or missing revision ('' when the default link does) */
  withdrawnValueKeys?: string[];
};

/**
 * [B19-E E4 review follow-up] Whether the part already has a default ('') link: a selectable one, or one whose revision was
 * withdrawn or is missing. Either way a publication never repoints it, so no default link is offered.
 */
function hasDefaultLink(detail: PartDetail): boolean {
  return (detail.atomicAssignments !== undefined && Object.hasOwn(detail.atomicAssignments, "")) || (Array.isArray(detail.withdrawnValueKeys) && detail.withdrawnValueKeys.includes(""));
}

const PAGE_SIZE = 30;
const EXTERNAL_SEARCH_FAILED = "The distributor search could not be completed.";

type ExternalSearchAnswer = Extract<ExternalSearchResult, { ok: true }>;

/** [B19-E E2] A source's state in words: what it answered, when a paused source may be tried again, or why it is not asked. */
function externalSourceWords(source: ExternalSearchSourceStatus): string {
  switch (source.status) {
    case "available":
      return source.servedFrom ? `${SERVED_FROM_WORDS[source.servedFrom]} · ${source.hitCount} found${source.withheldHits > 0 ? ` · ${source.withheldHits} withheld` : ""}` : "not searched";
    case "paused":
      return source.retryAt === null ? "paused" : `paused until ${utcMinute(source.retryAt)}`;
    case "failed":
      return "search failed";
    case "not_searchable":
      return "no candidate search";
    case "disabled":
      return `disabled${source.ownerDecision ? ` (${source.ownerDecision})` : ""}`;
    case "blocked":
      return "blocked";
    case "operator_disabled":
      return "switched off by the operator";
    case "credentials_missing":
      return "not configured";
  }
}

async function fetchCategories(): Promise<Category[]> {
  const res = await fetch("/api/parts/categories");
  const data = await res.json();
  if (!data.ok) throw new Error("bad response");
  return data.categories as Category[];
}

export function BuildLibraryPanel({
  onSelectForPlacement,
  projectScope = null,
}: {
  // Called when the user clicks "Place on canvas" for a part (Phase 2B). [B19-E E5] `exactIdentity`: "Use published exact revision",
  // resolved from this panel's fresh /api/parts/[id] detail ([B19-E E5 review]: never the page's never-invalidated part cache).
  onSelectForPlacement?: (partId: string, options?: { exactIdentity: AdoptedAtomicIdentity }) => void;
  /** [B19-E E2] the active project's selector: the distributor search is a member's read of that project */
  projectScope?: ProjectSelectorScope | null;
} = {}) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoriesError, setCategoriesError] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [results, setResults] = useState<PartSummary[]>([]);
  const [pagination, setPagination] = useState({ total: 0, offset: 0, limit: PAGE_SIZE });
  const [isLoading, setIsLoading] = useState(false);
  const [resultsError, setResultsError] = useState(false);

  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(false);

  // [B19-E E2] Search distributors
  const [externalOpen, setExternalOpen] = useState(false);
  const [externalMode, setExternalMode] = useState<ExternalSearchMode>("exact");
  const [externalQuery, setExternalQuery] = useState("");
  const [externalResult, setExternalResult] = useState<ExternalSearchAnswer | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [externalLoading, setExternalLoading] = useState(false);
  // [B19-E E4] the exact part whose evidence review is open
  const [evidenceReview, setEvidenceReview] = useState<AtomicPublicationPrefill | null>(null);

  // ── Categories ────────────────────────────────────────────────────────────

  const loadCategories = useCallback(async () => {
    try {
      const categories = await fetchCategories();
      setCategoriesError(false);
      setCategories(categories);
    } catch {
      setCategoriesError(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchCategories()
      .then((categories) => {
        if (cancelled) return;
        setCategoriesError(false);
        setCategories(categories);
      })
      .catch(() => {
        if (!cancelled) setCategoriesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Parts search (browse + semantic) ───────────────────────────────────────

  const runSearch = useCallback(
    async (category: string, query: string, offset: number, append: boolean) => {
      setIsLoading(true);
      setResultsError(false);
      try {
        const res = await fetch("/api/parts/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, category, offset, limit: PAGE_SIZE }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error("bad response");
        const incoming = data.results as PartSummary[];
        setResults((prev) => (append ? [...prev, ...incoming] : incoming));
        setPagination(data.pagination);
      } catch {
        setResultsError(true);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  // Debounced (300ms) load whenever the category or query changes.
  useEffect(() => {
    if (selectedCategory === null) return;
    const handle = setTimeout(() => {
      void runSearch(selectedCategory, searchQuery, 0, false);
    }, 300);
    return () => clearTimeout(handle);
  }, [selectedCategory, searchQuery, runSearch]);

  // ── Part detail ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (selectedPartId === null) return;
    let cancelled = false;
    fetch(`/api/parts/${selectedPartId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) throw new Error("bad response");
        setDetail(data.part as PartDetail | null);
      })
      .catch(() => {
        if (!cancelled) setDetailError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPartId]);

  function selectPart(partId: string) {
    setSelectedPartId(partId);
    setIsLoadingDetail(true);
    setDetailError(false);
    setDetail(null);
  }

  function closePart() {
    setSelectedPartId(null);
    setDetail(null);
    setIsLoadingDetail(false);
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openCategory(category: string) {
    setSelectedCategory(category);
    setSearchQuery("");
    setResults([]);
    setPagination({ total: 0, offset: 0, limit: PAGE_SIZE });
    closePart();
  }

  function backToCategories() {
    setSelectedCategory(null);
    setSearchQuery("");
    setResults([]);
    closePart();
  }

  function loadMore() {
    if (selectedCategory === null) return;
    void runSearch(selectedCategory, searchQuery, pagination.offset + pagination.limit, true);
  }

  const hasMore = pagination.offset + pagination.limit < pagination.total;

  // [B19-E E2] the server decides whether the search is live; the request carries the project selector and data only
  async function searchExternal() {
    if (!projectScope || externalLoading) return;
    setExternalLoading(true);
    setExternalError(null);
    try {
      const res = await fetch("/api/parts/external-search", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...projectSelectorHeaders(projectScope) },
        body: JSON.stringify({ query: externalQuery, mode: externalMode, limit: EXTERNAL_SEARCH_MAX_LIMIT }),
      });
      const data = (await res.json()) as ExternalSearchResult | { ok: false; error?: unknown };
      if (data.ok) {
        setExternalResult(data);
      } else {
        setExternalResult(null);
        setExternalError(typeof data.error === "string" ? data.error.slice(0, 200) : EXTERNAL_SEARCH_FAILED);
      }
    } catch {
      setExternalResult(null);
      setExternalError(EXTERNAL_SEARCH_FAILED);
    } finally {
      setExternalLoading(false);
    }
  }

  // [B19-E E4] a person asks for the exact part's evidence to be reviewed; nothing is requested until they submit the panel
  function requestEvidenceReview(prefill: AtomicPublicationPrefill) {
    if (!projectScope) return;
    setEvidenceReview(prefill);
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {evidenceReview !== null && projectScope && (
        // [B19-E E4 review] bounded and scrollable: the review never squeezes the part list away or runs past the sidebar
        <div className="p-2 border-b border-zinc-800 space-y-1 shrink-0 max-h-[60%] overflow-y-auto" data-testid="build-library-evidence-review">
          <div className="flex justify-end">
            <button onClick={() => setEvidenceReview(null)} title="Close evidence review" className="text-zinc-500 hover:text-zinc-200 transition">
              <X className="size-3.5" />
            </button>
          </div>
          <AtomicPublicationReviewSection key={`${evidenceReview.exactMpn ?? ""}:${evidenceReview.partId ?? ""}`} projectScope={projectScope} prefill={evidenceReview} />
        </div>
      )}
      {selectedCategory === null
        ? renderCategoryList()
        : renderPartsList()}

      {selectedPartId !== null && (
        <PreviewPanel
          detail={detail}
          isLoading={isLoadingDetail}
          error={detailError}
          onClose={closePart}
          onPlace={onSelectForPlacement}
          requestEvidenceReview={projectScope ? requestEvidenceReview : undefined}
        />
      )}
    </div>
  );

  // ── Category list view ──────────────────────────────────────────────────────

  function renderCategoryList() {
    return (
      <>
        <div className="p-3 border-b border-zinc-800">
          <div className="text-xs text-zinc-500">Build Library — Categories</div>
          {renderExternalSearchControls()}
        </div>
        <ScrollArea className="flex-1">
          {externalOpen && renderExternalSearchResults()}
          {categoriesError ? (
            <ErrorBlock label="Could not load categories" onRetry={() => void loadCategories()} />
          ) : categories === null ? (
            <LoadingBlock />
          ) : (
            <div className="p-2 space-y-0.5">
              {categories.map((cat) => (
                <button
                  key={cat.mainCategory}
                  onClick={() => openCategory(cat.mainCategory)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-zinc-300 hover:bg-zinc-800 transition group"
                >
                  <Package className="size-3.5 text-zinc-500 group-hover:text-teal-400 shrink-0" />
                  <span className="text-sm flex-1 truncate">{cat.mainCategory}</span>
                  <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                    {cat.partCount}
                  </span>
                  <ChevronRight className="size-3.5 text-zinc-600 group-hover:text-zinc-400" />
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </>
    );
  }

  // ── [B19-E E2] Search distributors ─────────────────────────────────────────

  function renderExternalSearchControls() {
    return (
      <div className="mt-2 space-y-2">
        <button
          onClick={() => setExternalOpen((open) => !open)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition"
        >
          <Search className="size-3.5" /> Search distributors
        </button>
        {externalOpen && (
          <div className="space-y-1.5">
            <div className="flex gap-1">
              <Button size="sm" variant={externalMode === "exact" ? "secondary" : "ghost"} className="h-6 text-[10px]" onClick={() => setExternalMode("exact")}>
                Exact MPN
              </Button>
              <Button size="sm" variant={externalMode === "keyword" ? "secondary" : "ghost"} className="h-6 text-[10px]" onClick={() => setExternalMode("keyword")}>
                Keyword
              </Button>
            </div>
            <div className="flex gap-1">
              <Input
                aria-label="Distributor search query"
                value={externalQuery}
                maxLength={EXTERNAL_SEARCH_MAX_QUERY_LENGTH}
                onChange={(e) => setExternalQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void searchExternal();
                }}
                placeholder={externalMode === "exact" ? "Exact MPN…" : "Keywords…"}
                className="h-7 border-zinc-800 bg-zinc-900 text-xs"
              />
              <Button size="sm" className="h-7 text-xs" disabled={!projectScope || externalLoading || externalQuery.trim() === ""} onClick={() => void searchExternal()}>
                {externalLoading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Search
              </Button>
            </div>
            {!projectScope && <div className="text-[10px] text-zinc-500">Open a project to search distributors.</div>}
          </div>
        )}
      </div>
    );
  }

  function renderExternalSearchResults() {
    if (!externalResult && !externalError) return null;
    return (
      <div data-testid="external-search-results" className="p-2 space-y-1.5 border-b border-zinc-800">
        {externalError && <div className="text-[10px] text-amber-300">{externalError}</div>}
        {externalResult && (
          <>
            <div className="flex flex-wrap gap-1">
              {externalResult.sources.map((source) => (
                <span key={source.sourceId} data-testid={`external-source-${source.sourceId}`} title={source.attribution} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {source.displayName} · {externalSourceWords(source)}
                </span>
              ))}
            </div>
            {externalResult.hits.length === 0 ? (
              <div className="text-[10px] text-zinc-600">No candidates found.</div>
            ) : (
              externalResult.hits.map((hit) => <ExternalHit key={`${hit.sourceId}:${hit.observationId}:${hit.mpn}`} hit={hit} query={externalResult.query} requestEvidenceReview={projectScope ? requestEvidenceReview : undefined} />)
            )}
          </>
        )}
      </div>
    );
  }

  // ── Parts list view ─────────────────────────────────────────────────────────

  function renderPartsList() {
    return (
      <>
        <div className="p-2 border-b border-zinc-800">
          <button
            onClick={backToCategories}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition mb-2"
          >
            <ChevronLeft className="size-3.5" /> Categories
          </button>
          <div className="px-1 mb-2">
            <div className="text-sm text-zinc-200 font-medium">{selectedCategory}</div>
            <div className="text-[10px] text-zinc-500">{pagination.total} parts</div>
          </div>
          <div className="relative">
            <Search className="size-3.5 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search this category…" aria-label="Search this category"
              className="pl-7 h-8 border-zinc-800 bg-zinc-900 text-xs"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {resultsError ? (
            <ErrorBlock
              label="Could not load parts"
              onRetry={() => selectedCategory && void runSearch(selectedCategory, searchQuery, 0, false)}
            />
          ) : results.length === 0 && isLoading ? (
            <LoadingBlock />
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-xs text-zinc-600">No parts found.</div>
          ) : (
            <div className="p-2 space-y-0.5">
              {results.map((part) => (
                <button
                  key={part.id}
                  onClick={() => selectPart(part.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition ${
                    selectedPartId === part.id
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{part.name}</div>
                    {part.mpn && (
                      <div className="text-[10px] font-mono text-zinc-500 truncate">{part.mpn}</div>
                    )}
                  </div>
                  {selectedPartId === part.id && (
                    <ChevronRight className="size-3.5 text-teal-400 shrink-0" />
                  )}
                </button>
              ))}

              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={isLoading}
                  className="w-full mt-1 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Load more
                </button>
              )}
            </div>
          )}
        </ScrollArea>
      </>
    );
  }
}

// ─── [B19-E E2] One external hit: labelled, and never placeable ─────────────

function ExternalHit({ hit, query, requestEvidenceReview }: { hit: ExternalCandidateHit; query: string; requestEvidenceReview?: (prefill: AtomicPublicationPrefill) => void }) {
  const pageHref = safeHref(hit.productUrl, "page", VENDOR_PAGE_HOSTS);
  // [B19-E E2 review] the link the source's terms require beside its data (Nexar: octopart.com), whether or not a page link exists
  const attributionHref = safeHref(hit.attributionLink, "page", VENDOR_PAGE_HOSTS);
  const firstBreak = hit.priceBreaks[0];
  return (
    <div data-testid="external-hit" className="rounded border border-zinc-800 bg-zinc-900/40 p-2 space-y-0.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <span data-testid="external-hit-source" className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">{hit.sourceDisplayName}</span>
        <span className="font-mono text-xs text-zinc-200 truncate">{hit.mpn}</span>
      </div>
      <div className={`text-[10px] ${hit.exactMatch ? "text-teal-300" : "text-amber-300"}`}>
        {hit.exactMatch ? "exact MPN match" : `not an exact match for ${query}`}
      </div>
      {hit.manufacturer && <div className="text-[10px] text-zinc-400 truncate">{hit.manufacturer}</div>}
      {hit.description && <div className="text-[10px] text-zinc-500 break-words">{hit.description}</div>}
      {(hit.stock !== null || firstBreak) && (
        <div className="text-[10px] text-zinc-500">
          {hit.stock !== null ? `stock ${hit.stock}` : ""}
          {hit.stock !== null && firstBreak ? " · " : ""}
          {firstBreak ? `${firstBreak.currency} ${firstBreak.unitPrice} at qty ${firstBreak.quantity}` : ""}
        </div>
      )}
      <div className="text-[10px] text-zinc-500">
        <span data-testid="external-hit-served-from">{SERVED_FROM_WORDS[hit.servedFrom]}</span> · observed {utcMinute(hit.observedAt)} · expires {utcMinute(hit.expiresAt)}
      </div>
      <div className="text-[10px] text-amber-200/80">{EXTERNAL_OBSERVATION_AUTHORITY}</div>
      <div data-testid="external-hit-attribution" title={hit.attribution} className="text-[10px] text-zinc-500">
        data from {hit.sourceDisplayName}
        {attributionHref && (
          <>
            {" · "}
            <a href={attributionHref} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300">
              {new URL(attributionHref).hostname}
            </a>
          </>
        )}
      </div>
      {pageHref && (
        <a href={pageHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300">
          {hit.sourceDisplayName} page <ExternalLink className="size-3" />
        </a>
      )}
      {/* [B19-E E4] only the exact part may be put to review; a near match is a different part */}
      {requestEvidenceReview && hit.exactMatch && (
        <Button size="sm" variant="secondary" className="h-6 text-[10px]" onClick={() => requestEvidenceReview({ exactMpn: hit.mpn })}>
          Request evidence review
        </Button>
      )}
    </div>
  );
}

// ─── Preview panel (floats to the right of the sidebar) ─────────────────────

function PreviewPanel({
  detail,
  isLoading,
  error,
  onClose,
  onPlace,
  requestEvidenceReview,
}: {
  detail: PartDetail | null;
  isLoading: boolean;
  error: boolean;
  onClose: () => void;
  onPlace?: (partId: string, options?: { exactIdentity: AdoptedAtomicIdentity }) => void;
  /** [B19-E E4] open the evidence review for this part's exact MPN */
  requestEvidenceReview?: (prefill: AtomicPublicationPrefill) => void;
}) {
  // [B19-E E4 review follow-up] a default link counts whether its revision is selectable or was withdrawn (the server refuses both)
  const alreadyLinked = detail !== null && hasDefaultLink(detail);
  // [B19-E E5] the value a placement takes (as the canvas places it) has a selectable link to adopt, or nothing is offered
  const exactIdentity = detail !== null ? adoptPublishedExactRevision(detail, detail.properties?.["Value"] || detail.name) : null;
  const adoptable = exactIdentity !== null;
  function placeExactRevision(partId: string) {
    // [B19-E E5 review] the identity this fresh detail resolved travels with the placement; the page never re-resolves it
    if (exactIdentity) onPlace?.(partId, { exactIdentity });
  }
  return (
    <aside className="absolute top-0 left-full h-full w-96 z-30 bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col">
      <div className="h-10 px-3 flex items-center gap-2 border-b border-zinc-800 shrink-0">
        <span className="text-sm text-zinc-200 font-medium flex-1 truncate">
          {detail?.name ?? "Part preview"}
        </span>
        {detail && onPlace && (
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onPlace(detail.id)}>
            <Plus className="size-3.5" /> Place
          </Button>
        )}
        {detail && onPlace && adoptable && (
          <Button size="sm" variant="secondary" className="h-7 text-xs" title="Place with the part's published exact atomic revision (a reviewer still binds it)" onClick={() => placeExactRevision(detail.id)}>
            Use published exact revision
          </Button>
        )}
        <button onClick={onClose} title="Close" className="text-zinc-500 hover:text-zinc-200 transition">
          <X className="size-4" />
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
          Could not load part.
        </div>
      ) : isLoading || detail === null ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-5 text-zinc-600 animate-spin" />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Symbol */}
            <div className="h-60 rounded-md border border-zinc-800 bg-zinc-900/40 flex items-center justify-center overflow-hidden">
              <KicadSymbol symbolRaw={detail.symbolRaw} />
            </div>

            {/* Metadata */}
            <div className="space-y-1.5 text-xs">
              {detail.atomicCompatibility && (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200">
                  Legacy catalog candidate — not an approved atomic revision. PCB assignment still requires exact mapping/package proof.
                </div>
              )}
              <MetaRow label="MPN" value={detail.mpn} mono />
              <MetaRow label="Manufacturer" value={detail.manufacturer} />
              <MetaRow label="Library" value={detail.libraryName} mono />
              <MetaRow label="Pins" value={String(detail.pins.length)} />
              {detail.footprintHint && <MetaRow label="Footprint" value={detail.footprintHint} mono />}
              <DatasheetLink href={detail.datasheet} className="inline-flex items-center gap-1 text-teal-400 hover:text-teal-300 transition pt-1">
                Datasheet <ExternalLink className="size-3" />
              </DatasheetLink>
              {requestEvidenceReview && detail.mpn && (
                <div className="pt-1">
                  <Button size="sm" variant="secondary" className="h-6 text-[10px]" onClick={() => requestEvidenceReview({ exactMpn: detail.mpn ?? "", symbol: { library: detail.libraryName, name: detail.name }, footprint: footprintReference(detail.footprintHint), manufacturer: detail.manufacturer, partId: detail.id, alreadyLinked })}>
                    Request evidence review
                  </Button>
                </div>
              )}
            </div>

            {/* Description */}
            {detail.description && (
              <>
                <div className="h-px bg-zinc-800" />
                <p className="text-xs text-zinc-400 leading-relaxed">{detail.description}</p>
              </>
            )}

            {/* Keywords */}
            {detail.keywords && (
              <div className="flex flex-wrap gap-1">
                {detail.keywords
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((kw, i) => (
                    <Badge key={`${kw}-${i}`} variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-400">
                      {kw}
                    </Badge>
                  ))}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}

/** [B19-E E4] "Library:Footprint" as a bundled-library reference, when the hint has that shape. */
function footprintReference(hint: string | null): { library: string; name: string } | null {
  const match = hint ? /^([^:\s]+):([^:\s]+)$/.exec(hint.trim()) : null;
  return match ? { library: match[1]!, name: match[2]! } : null;
}

function MetaRow({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-zinc-500 w-24 shrink-0">{label}</span>
      <span className={`text-zinc-300 break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

// ─── Shared small blocks ────────────────────────────────────────────────────

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="size-5 text-zinc-600 animate-spin" />
    </div>
  );
}

function ErrorBlock({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-xs text-zinc-500">
      <span>{label}</span>
      <Button size="sm" variant="secondary" onClick={onRetry} className="gap-1.5 h-7">
        <RotateCw className="size-3" /> Retry
      </Button>
    </div>
  );
}
