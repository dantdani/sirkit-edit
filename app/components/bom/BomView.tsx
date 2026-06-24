"use client";

/**
 * Bill of Materials with live distributor pricing.
 *
 * Posts the current SchematicState to /api/bom, which groups components into
 * line items and attaches pricing/stock from the user's chosen source (DigiKey,
 * Octopart, both, or none). Renders a sortable/filterable table with totals and
 * CSV export. All distributor API calls happen server-side — this component only
 * ever talks to /api/bom and /api/bom/export-csv.
 *
 * Accepts either the canonical `{ state }` prop or the legacy
 * `{ components, kicadComponents }` pair, so it drops into the existing BOM tab
 * without a parent change; the later integration pass can switch to `{ state }`.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  SchematicState,
  SchComponent,
  KicadComponentInstance,
} from "@/lib/schematic-types";
import type { BomRow, BomResult } from "@/app/lib/bom/build";
import type { DistributorChoice, PartPricing } from "@/app/lib/distributors";

type Props =
  | { state: SchematicState }
  | { components: SchComponent[]; kicadComponents: KicadComponentInstance[] };

const STORAGE_KEY = "sirkit:bom:pricingChoice";

const CHOICE_LABELS: Record<DistributorChoice, string> = {
  none: "None",
  digikey: "DigiKey",
  mouser: "Mouser",
  octopart: "Octopart",
  all: "All",
};

const CHOICE_ORDER: DistributorChoice[] = ["none", "digikey", "mouser", "octopart", "all"];

/** Human label for a distributor name as it appears on a PartPricing offer. */
function distributorLabel(name: string): string {
  switch (name) {
    case "digikey":
      return "DigiKey";
    case "mouser":
      return "Mouser";
    case "octopart-aggregated":
      return "Octopart";
    case "lcsc":
      return "LCSC";
    default:
      return name;
  }
}

/** Unit price at a target quantity: the highest break with qty ≤ target. */
function priceAtQty(breaks: { qty: number; price: number; currency: string }[], target: number): number | null {
  let chosen: { qty: number; price: number } | null = null;
  for (const b of breaks) {
    if (b.qty <= target && (chosen === null || b.qty > chosen.qty)) chosen = b;
  }
  // Below the smallest break, fall back to the cheapest-qty break.
  if (chosen === null && breaks.length > 0) {
    chosen = breaks.reduce((min, b) => (b.qty < min.qty ? b : min), breaks[0]);
  }
  return chosen ? chosen.price : null;
}

// ─── refDes natural sort (mirrors the server's grouping order) ─────────────────
function refDesSort(a: string, b: string): number {
  const ma = a.match(/^([A-Za-z]+)(\d*)$/);
  const mb = b.match(/^([A-Za-z]+)(\d*)$/);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1]);
    return (parseInt(ma[2] || "0", 10) || 0) - (parseInt(mb[2] || "0", 10) || 0);
  }
  return a.localeCompare(b);
}

type SortKey =
  | "refDes"
  | "qty"
  | "name"
  | "mpn"
  | "manufacturer"
  | "package"
  | "value"
  | "stock"
  | "unit"
  | "ext";

function bestUnit(row: BomRow): number | null {
  return row.pricing?.bestOverall?.bestUnitPrice ?? null;
}
function stockOf(row: BomRow): number | null {
  return row.pricing?.bestOverall?.inStock ?? null;
}
function currencyOf(row: BomRow): string | null {
  const best = row.pricing?.bestOverall;
  if (!best || best.bestUnitPrice === null) return null;
  return best.priceBreaks.find((b) => b.price === best.bestUnitPrice)?.currency ?? "USD";
}
function productUrlOf(row: BomRow): string | null {
  return row.pricing?.bestOverall?.productUrl ?? null;
}

function compareRows(a: BomRow, b: BomRow, key: SortKey): number {
  switch (key) {
    case "refDes":
      return refDesSort(a.refDesList[0] ?? a.name, b.refDesList[0] ?? b.name);
    case "qty":
      return a.qty - b.qty;
    case "name":
      return a.name.localeCompare(b.name);
    case "mpn":
      return (a.mpn ?? "").localeCompare(b.mpn ?? "");
    case "manufacturer":
      return (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "");
    case "package":
      return (a.package ?? "").localeCompare(b.package ?? "");
    case "value":
      return (a.value ?? "").localeCompare(b.value ?? "");
    case "stock":
      return nullLast(stockOf(a)) - nullLast(stockOf(b));
    case "unit":
      return nullLast(bestUnit(a)) - nullLast(bestUnit(b));
    case "ext": {
      const ea = bestUnit(a);
      const eb = bestUnit(b);
      return nullLast(ea === null ? null : ea * a.qty) - nullLast(eb === null ? null : eb * b.qty);
    }
  }
}

// Push null/absent values to the end regardless of sort direction's flip.
function nullLast(n: number | null): number {
  return n === null ? Number.POSITIVE_INFINITY : n;
}

function fmtPrice(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  const code = currency ?? "USD";
  return `${value.toFixed(value < 1 ? 4 : 2)} ${code}`;
}

function stockColor(stock: number | null): string {
  if (stock === null) return "text-zinc-600";
  if (stock > 1000) return "text-emerald-400";
  if (stock >= 100) return "text-amber-400";
  return "text-red-400";
}

function loadChoice(): DistributorChoice {
  if (typeof window === "undefined") return "none";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "both") return "all"; // migrate the legacy persisted value
  if ((CHOICE_ORDER as string[]).includes(stored ?? "")) {
    return stored as DistributorChoice;
  }
  return "none";
}

export function BomView(props: Props) {
  const state: SchematicState = useMemo(() => {
    if ("state" in props) return props.state;
    return { components: props.components, wires: [], kicadComponents: props.kicadComponents };
  }, [props]);

  const components = state.components ?? [];
  const kicadComponents = state.kicadComponents ?? [];

  const [pricingChoice, setPricingChoice] = useState<DistributorChoice>("none");
  const [result, setResult] = useState<BomResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "refDes", dir: 1 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Set just before a "Refresh prices" click so the next fetch bypasses the cache.
  const forceRef = useRef(false);

  // Hydrate the persisted choice on mount (client-only).
  useEffect(() => {
    setPricingChoice(loadChoice());
  }, []);

  const onChoiceChange = (choice: DistributorChoice) => {
    setPricingChoice(choice);
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* storage unavailable (private mode) — non-fatal */
    }
  };

  // A signature that changes only when the orderable BOM content changes — keeps
  // the fetch effect from looping on every parent re-render (new state object).
  const signature = useMemo(() => {
    const k = (state.kicadComponents ?? []).map((c) => `${c.partId}:${c.value}:${c.refDes}`).join("|");
    const t = (state.components ?? [])
      .filter((c) => c.type !== "ground")
      .map((c) => `${c.type}:${c.value}:${c.id}`)
      .join("|");
    return `${k}#${t}`;
  }, [state]);

  const isEmpty = components.filter((c) => c.type !== "ground").length === 0 && kicadComponents.length === 0;

  // Carry the live state into fetch requests without making it a fetch dep
  // (the parent passes a fresh state object every render).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const fetchBom = useCallback(async () => {
    if (isEmpty) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const forceRefresh = forceRef.current;
      const res = await fetch("/api/bom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateRef.current, pricingChoice, forceRefresh }),
      });
      const data = (await res.json()) as BomResult | { ok: false; error: string };
      if (!data.ok) {
        setError("error" in data ? data.error : "Failed to build BOM");
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setResult(null);
    } finally {
      forceRef.current = false; // one-shot — clear after the request settles
      setLoading(false);
    }
    // signature is included so a content change refetches; stateRef carries the
    // live state into the request without retriggering on object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingChoice, signature, refreshNonce, isEmpty]);

  useEffect(() => {
    void fetchBom();
  }, [fetchBom]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/bom/export-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateRef.current, pricingChoice }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sirkit-bom.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const rows = useMemo(() => {
    if (!result) return [];
    const sorted = [...result.rows].sort((a, b) => compareRows(a, b, sort.key) * sort.dir);
    return sorted;
  }, [result, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  };

  const toggleExpand = (rowKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  // Re-fetch with the cache bypassed.
  const refreshPrices = () => {
    forceRef.current = true;
    setRefreshNonce((n) => n + 1);
  };

  if (isEmpty) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm select-none">
        No components yet — generate or place parts to see the bill of materials.
      </div>
    );
  }

  const cost = result?.estimatedProjectCost ?? null;
  const warnings = result?.warnings ?? [];

  return (
    <div className="absolute inset-0 flex flex-col bg-zinc-950">
      {/* ── Settings bar ── */}
      <div className="flex items-center gap-3 px-3 h-11 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <span className="text-xs text-zinc-300 font-medium">Bill of Materials</span>

        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          Pricing
          <select
            value={pricingChoice}
            onChange={(e) => onChoiceChange(e.target.value as DistributorChoice)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 h-7 text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
          >
            {CHOICE_ORDER.map((c) => (
              <option key={c} value={c}>
                {CHOICE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        {/* Cache freshness badge */}
        {result && pricingChoice !== "none" && (
          <span className="text-[11px] text-zinc-500">
            {result.cached} cached, {result.fetched} fetched live just now
          </span>
        )}

        <button
          onClick={() => setRefreshNonce((n) => n + 1)}
          disabled={loading}
          className="text-xs px-2 h-7 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>

        <button
          onClick={refreshPrices}
          disabled={loading || pricingChoice === "none"}
          title="Bypass the cache and re-fetch live pricing from all selected sources"
          className="text-xs px-2 h-7 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          Refresh prices
        </button>

        <button
          onClick={exportCsv}
          disabled={exporting || !result}
          className="text-xs px-2 h-7 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>

        <div className="ml-auto text-xs text-zinc-400">
          {cost && cost.value !== null ? (
            <span>
              Project cost:{" "}
              <span className="font-mono text-teal-300">
                {cost.value.toFixed(2)} {cost.currency ?? "USD"}
              </span>{" "}
              <span className="text-zinc-600">(qty 1)</span>
            </span>
          ) : pricingChoice === "none" ? (
            <span className="text-zinc-600">Pricing off</span>
          ) : (
            <span className="text-zinc-600">No pricing</span>
          )}
        </div>
      </div>

      {/* ── Warnings / errors ── */}
      {warnings.map((w) => (
        <div
          key={w}
          className="px-3 py-1.5 text-[11px] text-amber-300/90 bg-amber-950/30 border-b border-amber-900/40 shrink-0"
        >
          {w}
        </div>
      ))}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-red-300 bg-red-950/30 border-b border-red-900/40 shrink-0">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <Th className="w-10">#</Th>
              <Th sortKey="refDes" sort={sort} onSort={toggleSort}>RefDes</Th>
              <Th sortKey="qty" sort={sort} onSort={toggleSort} className="text-right">Qty</Th>
              <Th sortKey="name" sort={sort} onSort={toggleSort}>Name</Th>
              <Th sortKey="mpn" sort={sort} onSort={toggleSort}>MPN</Th>
              <Th sortKey="manufacturer" sort={sort} onSort={toggleSort}>Manufacturer</Th>
              <Th sortKey="package" sort={sort} onSort={toggleSort}>Package</Th>
              <Th sortKey="value" sort={sort} onSort={toggleSort}>Value</Th>
              <Th>Best Source</Th>
              <Th sortKey="stock" sort={sort} onSort={toggleSort} className="text-right">Stock</Th>
              <Th sortKey="unit" sort={sort} onSort={toggleSort} className="text-right">Unit Price</Th>
              <Th sortKey="ext" sort={sort} onSort={toggleSort} className="text-right">Ext. Price</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {rows.map((row, i) => {
              const unit = bestUnit(row);
              const currency = currencyOf(row);
              const stock = stockOf(row);
              const url = productUrlOf(row);
              const hasPricing = pricingChoice !== "none" && row.pricing !== null;
              const offers = row.pricing?.offers ?? [];
              const best = row.pricing?.bestOverall ?? null;
              const rowKey = `${row.partId ?? row.name}|${row.value ?? ""}|${i}`;
              const isExpandable = offers.length > 0;
              const isOpen = expanded.has(rowKey);
              return (
                <Fragment key={rowKey}>
                  <tr
                    className={`hover:bg-zinc-900/50 ${isExpandable ? "cursor-pointer" : ""}`}
                    onClick={isExpandable ? () => toggleExpand(rowKey) : undefined}
                  >
                    <Td className="text-zinc-500">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 text-zinc-600">
                          {isExpandable ? (isOpen ? "▾" : "▸") : ""}
                        </span>
                        {i + 1}
                      </span>
                    </Td>
                    <Td className="font-mono text-[11px] text-zinc-200">{row.refDes}</Td>
                    <Td className="text-right tabular-nums">{row.qty}</Td>
                    <Td>
                      <div className="font-medium text-zinc-100">{row.name}</div>
                      {row.category && <div className="text-[10px] text-zinc-500">{row.category}</div>}
                    </Td>
                    <Td className="font-mono text-[11px]">{dash(row.mpn)}</Td>
                    <Td>{dash(row.manufacturer)}</Td>
                    <Td>
                      {row.package ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300">
                          {row.package}
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </Td>
                    <Td className="font-mono">{dash(row.value)}</Td>
                    <Td className="whitespace-nowrap">
                      {hasPricing && best ? (
                        <span>
                          <span className="text-zinc-300">{distributorLabel(best.distributor)}</span>
                          <span className="text-zinc-600"> · </span>
                          <span className="font-mono text-zinc-200">{fmtPrice(best.bestUnitPrice, currency)}</span>
                          {offers.length > 1 && <span className="text-amber-400" title="cheapest of all sources"> ★</span>}
                        </span>
                      ) : (
                        <Muted>—</Muted>
                      )}
                    </Td>
                    <Td className={`text-right tabular-nums ${stockColor(stock)}`}>
                      {hasPricing ? (stock !== null ? stock.toLocaleString() : "—") : <Muted>—</Muted>}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">
                      {hasPricing ? (
                        unit !== null ? (
                          fmtPrice(unit, currency)
                        ) : (
                          <Muted>no pricing</Muted>
                        )
                      ) : (
                        <Muted>—</Muted>
                      )}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">
                      {hasPricing && unit !== null ? fmtPrice(unit * row.qty, currency) : <Muted>—</Muted>}
                    </Td>
                    <Td>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open distributor product page"
                          className="text-teal-400 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          ↗
                        </a>
                      ) : (
                        <span className="text-zinc-700">↗</span>
                      )}
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-zinc-900/40">
                      <td className="px-3 py-2 border-b border-zinc-800/70" colSpan={13}>
                        <OfferDetail offers={offers} bestDistributor={best?.distributor ?? null} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {loading && rows.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-500">
            <Spinner /> Building BOM…
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 text-[11px] text-zinc-600 border-t border-zinc-800 shrink-0">
        {result
          ? `${result.rows.length} line item${result.rows.length === 1 ? "" : "s"} · ${result.cached} cached · ${result.fetched} fetched live`
          : "—"}
      </div>
    </div>
  );
}

// ─── Small presentational helpers ──────────────────────────────────────────────

const TH_BASE =
  "px-3 py-2 text-left font-medium text-zinc-400 sticky top-0 bg-zinc-950 border-b border-zinc-800 select-none";
const TD_BASE = "px-3 py-1.5 align-top border-b border-zinc-800/70";

function Th({
  children,
  className = "",
  sortKey,
  sort,
  onSort,
}: {
  children?: ReactNode;
  className?: string;
  sortKey?: SortKey;
  sort?: { key: SortKey; dir: 1 | -1 };
  onSort?: (key: SortKey) => void;
}) {
  if (!sortKey || !onSort) {
    return <th className={`${TH_BASE} ${className}`}>{children}</th>;
  }
  const active = sort?.key === sortKey;
  const arrow = active ? (sort.dir === 1 ? " ▲" : " ▼") : "";
  return (
    <th className={`${TH_BASE} ${className} cursor-pointer hover:text-zinc-200`} onClick={() => onSort(sortKey)}>
      {children}
      <span className="text-teal-400">{arrow}</span>
    </th>
  );
}

function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`${TD_BASE} ${className}`}>{children}</td>;
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-zinc-600">{children}</span>;
}

/** Per-source breakdown shown when a BOM row is expanded. */
function OfferDetail({
  offers,
  bestDistributor,
}: {
  offers: PartPricing[];
  bestDistributor: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-zinc-500">
            <th className="text-left font-medium px-2 py-1">Distributor</th>
            <th className="text-left font-medium px-2 py-1">SKU</th>
            <th className="text-right font-medium px-2 py-1">Stock</th>
            <th className="text-right font-medium px-2 py-1">Price (qty 1)</th>
            <th className="text-right font-medium px-2 py-1">Price (qty 100)</th>
            <th className="text-right font-medium px-2 py-1">Price (qty 1000)</th>
            <th className="text-left font-medium px-2 py-1">Lead time</th>
            <th className="text-left font-medium px-2 py-1">Link</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {offers.map((o, idx) => {
            const cur = o.priceBreaks[0]?.currency ?? "USD";
            const isBest = o.distributor === bestDistributor;
            return (
              <tr key={`${o.distributor}:${idx}`} className={isBest ? "text-zinc-100" : ""}>
                <td className="px-2 py-1">
                  {distributorLabel(o.distributor)}
                  {isBest && (
                    <span className="text-amber-400" title="best price">
                      {" "}
                      ★
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 font-mono">
                  {o.sku ? o.sku : <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {o.inStock !== null ? o.inStock.toLocaleString() : "—"}
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{fmtPrice(priceAtQty(o.priceBreaks, 1), cur)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{fmtPrice(priceAtQty(o.priceBreaks, 100), cur)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{fmtPrice(priceAtQty(o.priceBreaks, 1000), cur)}</td>
                {/* Lead time isn't captured in PartPricing yet — placeholder for a later stage. */}
                <td className="px-2 py-1 text-zinc-500">—</td>
                <td className="px-2 py-1">
                  {o.productUrl ? (
                    <a
                      href={o.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal-400 hover:underline"
                    >
                      ↗
                    </a>
                  ) : (
                    <span className="text-zinc-700">↗</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function dash(v: string | null) {
  return v && v.trim() !== "" ? v : <span className="text-zinc-600">—</span>;
}

function Spinner() {
  return (
    <span className="inline-block w-3.5 h-3.5 border-2 border-zinc-600 border-t-teal-400 rounded-full animate-spin" />
  );
}
