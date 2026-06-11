"use client";

/**
 * Build mode's parts catalog (Phase 2A — discovery only, no canvas placement).
 *
 * Flow: category list → drill into a category → browse/search parts → click a
 * part to open a floating preview with the rendered KiCad symbol + metadata.
 * Self-contained: manages its own state and data fetching; no props needed yet.
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
};

const PAGE_SIZE = 30;

export function BuildLibraryPanel({
  onSelectForPlacement,
}: {
  // Called when the user clicks "Place on canvas" for a part (Phase 2B).
  onSelectForPlacement?: (partId: string) => void;
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

  // ── Categories ────────────────────────────────────────────────────────────

  const loadCategories = useCallback(async () => {
    setCategoriesError(false);
    try {
      const res = await fetch("/api/parts/categories");
      const data = await res.json();
      if (!data.ok) throw new Error("bad response");
      setCategories(data.categories as Category[]);
    } catch {
      setCategoriesError(true);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

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
    if (selectedPartId === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setIsLoadingDetail(true);
    setDetailError(false);
    setDetail(null);
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

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openCategory(category: string) {
    setSelectedCategory(category);
    setSearchQuery("");
    setResults([]);
    setPagination({ total: 0, offset: 0, limit: PAGE_SIZE });
    setSelectedPartId(null);
  }

  function backToCategories() {
    setSelectedCategory(null);
    setSearchQuery("");
    setResults([]);
    setSelectedPartId(null);
  }

  function loadMore() {
    if (selectedCategory === null) return;
    void runSearch(selectedCategory, searchQuery, pagination.offset + pagination.limit, true);
  }

  const hasMore = pagination.offset + pagination.limit < pagination.total;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {selectedCategory === null
        ? renderCategoryList()
        : renderPartsList()}

      {selectedPartId !== null && (
        <PreviewPanel
          detail={detail}
          isLoading={isLoadingDetail}
          error={detailError}
          onClose={() => setSelectedPartId(null)}
          onPlace={onSelectForPlacement}
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
        </div>
        <ScrollArea className="flex-1">
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
              placeholder="Search this category…"
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
                  onClick={() => setSelectedPartId(part.id)}
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

// ─── Preview panel (floats to the right of the sidebar) ─────────────────────

function PreviewPanel({
  detail,
  isLoading,
  error,
  onClose,
  onPlace,
}: {
  detail: PartDetail | null;
  isLoading: boolean;
  error: boolean;
  onClose: () => void;
  onPlace?: (partId: string) => void;
}) {
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
              <MetaRow label="MPN" value={detail.mpn} mono />
              <MetaRow label="Manufacturer" value={detail.manufacturer} />
              <MetaRow label="Library" value={detail.libraryName} mono />
              <MetaRow label="Pins" value={String(detail.pins.length)} />
              {detail.footprintHint && <MetaRow label="Footprint" value={detail.footprintHint} mono />}
              {detail.datasheet && (
                <a
                  href={detail.datasheet}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-teal-400 hover:text-teal-300 transition pt-1"
                >
                  Datasheet <ExternalLink className="size-3" />
                </a>
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
