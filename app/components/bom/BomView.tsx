"use client";

/**
 * Bill of Materials with distributor pricing observations.
 *
 * Posts the current SchematicState to /api/bom, which groups components into
 * line items and attaches pricing/stock from the user's chosen source (DigiKey,
 * Octopart, all, or none). Renders a sortable/filterable table with totals and
 * CSV export. All distributor API calls happen server-side — this component only
 * ever talks to the /api/bom routes. [B19-E E1] Each offer states its source, whether
 * it is live or cached, when it was observed and when it expires; distributor
 * exports are files the person uploads themselves — nothing is sent and no order is placed.
 *
 * Accepts either the canonical `{ state }` prop or the legacy
 * `{ components, kicadComponents }` pair, so it drops into the existing BOM tab
 * without a parent change; the later integration pass can switch to `{ state }`.
 */

import { lineCurrency, lineUnitPrice } from "@/app/lib/bom/line-price"; // [B19-D I5b review]
import { projectSelectorHeaders, type ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  SchematicState,
  SchComponent,
  KicadComponentInstance,
} from "@/lib/schematic-types";
import type { BomCatalogStatus, BomRow, BomResult, BomLifecycleSummary } from "@/app/lib/bom/build";
import { LIFECYCLE_SEVERITY } from "@/app/lib/distributors/shared";
import type { DistributorChoice, PartPricing, LifecycleStatus } from "@/app/lib/distributors/shared";
import type { RiskGrade, DesignRiskSummary } from "@/app/lib/risk-scoring";
import {
  DISTRIBUTOR_UPLOAD_URLS,
  offerLinkUrl,
  vendorProductPageUrl,
  type CartDistributor,
} from "@/app/lib/distributor-links"; // [B19-D I5c row 34, review] the shared, tested link policy
import { safeHref, VENDOR_PAGE_HOSTS } from "@/app/lib/net/href-policy"; // [B19-E E1]
import { SOURCE_IDS, SOURCE_REGISTRY } from "@/app/lib/acquisition/source-registry"; // [B19-E E1] browser-safe, static
import { offerFreshness, sourceLabel, utcMinute } from "@/app/lib/acquisition/source-labels"; // [B19-E E1]
import type { Change } from "@/app/lib/snapshots";
import { changeToNotification, type NotificationSeverity } from "@/app/lib/notifications";

type Props = (
  | { state: SchematicState }
  | { components: SchComponent[]; kicadComponents: KicadComponentInstance[] }
) & {
  /** [B16.0.2 §B] the ACTIVE project identity from the page — a SELECTOR only
   *  (never authority; the server derives ownership from the session +
   *  membership). Snapshot/notification/diff surfaces require it; there is NO
   *  content-hash fallback. */
  projectScope?: ProjectSelectorScope | null;
  /**
   * Called when the user clicks "Swap" on an alternate. The parent (page.tsx)
   * implements the schematic-state mutation. When undefined, Swap is disabled.
   */
  onSwapPart?: (sourcePartId: string, newPartId: string) => void;
  /**
   * [B19-E E5] Called when the user clicks "Review successor" on a line whose atomic revision was withdrawn and names a successor.
   * The page opens the component review, where a reviewer previews and rebinds; nothing is changed from here. Absent ⇒ no action.
   */
  onReviewSuccessor?: (row: BomRow) => void;
};

// ─── Snapshot / notification client types & helpers ─────────────────────────--

type SnapshotMeta = {
  id: string;
  label: string | null;
  takenAt: string;
  rowCount: number;
  totalCostCents: number | null;
  currency: string | null;
  designRiskScore: number;
};

type NotifItem = {
  id: string;
  type: string;
  severity: NotificationSeverity;
  partId: string | null;
  summary: string;
  createdAt: string;
  readAt: string | null;
};

/** Deterministic JSON with sorted object keys (for a stable state hash). */


function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const SEVERITY_STYLE: Record<NotificationSeverity, { glyph: string; className: string }> = {
  info: { glyph: "ℹ", className: "text-blue-400" },
  warning: { glyph: "⚠", className: "text-amber-400" },
  critical: { glyph: "⛔", className: "text-red-400" },
};

const STORAGE_KEY = "sirkit:bom:pricingChoice";

type ChoiceOption = { value: string; label: string; selectable: boolean };

const SOURCE_CHOICES: ReadonlySet<string> = new Set<DistributorChoice>(["digikey", "mouser", "octopart"]);

/**
 * [B19-E E1] The pricing picker, from the static source registry (never admission or the environment): every registry
 * source is listed; one that is not enabled, or is not a pricing choice, is shown with its state and owner decision and
 * cannot be selected.
 */
const CHOICE_OPTIONS: readonly ChoiceOption[] = [
  { value: "none", label: "None", selectable: true },
  ...SOURCE_IDS.map((id): ChoiceOption => {
    const { displayName, state } = SOURCE_REGISTRY[id];
    const selectable = state.status === "enabled" && SOURCE_CHOICES.has(id);
    const decision = state.ownerDecision ? ` (${state.ownerDecision})` : "";
    return { value: id, label: selectable ? displayName : `${displayName} — ${state.status}${decision}`, selectable };
  }),
  { value: "all", label: "All enabled", selectable: true },
];

const SELECTABLE_CHOICES: ReadonlySet<string> = new Set(CHOICE_OPTIONS.filter((option) => option.selectable).map((option) => option.value));

/** Human label for a distributor name as it appears on a PartPricing offer. */
function distributorLabel(name: string): string {
  return sourceLabel(name)?.displayName ?? name; // [B19-E E1] the registry's display name
}

type PricingSource = BomResult["sources"][number];

/** [B19-E E1] A source's state in words; a missing credential is named only as not configured. */
function sourceStatusText(source: PricingSource): string {
  switch (source.status) {
    case "available":
      return "available";
    case "paused":
      return source.retryAt !== null ? `paused · retry after ${utcMinute(source.retryAt)}` : "paused";
    case "disabled":
      return source.ownerDecision ? `disabled (${source.ownerDecision})` : "disabled";
    case "blocked":
      return "blocked";
    case "operator_disabled":
      return "switched off by the operator";
    case "credentials_missing":
      return "credentials not configured";
  }
}

const SOURCE_CHIP_STYLE: Record<PricingSource["status"], string> = {
  available: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40",
  paused: "bg-amber-500/10 text-amber-300 border-amber-500/40",
  disabled: "bg-zinc-800/60 text-zinc-400 border-zinc-700",
  blocked: "bg-red-500/10 text-red-300 border-red-500/40",
  operator_disabled: "bg-zinc-800/60 text-zinc-400 border-zinc-700",
  credentials_missing: "bg-zinc-800/60 text-zinc-400 border-zinc-700",
};

/** [B19-E E1] May this observation still be shown? Offline, an offer past its expiry (or of a no-storage source) is not. */
function offerServable(offer: PartPricing, now: number): boolean {
  return offerFreshness(offer, now)?.servable ?? false;
}

/** [B19-E E1-C review] Past the expiry of a source whose observations may be served for a while, online or offline. */
function offerExpired(offer: PartPricing, now: number): boolean {
  return (sourceLabel(offer.distributor)?.servedForMs ?? 0) > 0 && !offerServable(offer, now);
}

/** [B19-E E1-C review] Not shown: an offer past its expiry, online or offline; offline, also one that is never kept (no-storage or unregistered). */
function offerWithheld(offer: PartPricing, now: number, offline: boolean): boolean {
  return offerExpired(offer, now) || (offline && !offerServable(offer, now));
}

/** [B19-E E1-C review] What a shown result was for, when it arrived (client clock) and how far the server clock was ahead then. */
type ResultFor = { pricingChoice: DistributorChoice; signature: string; receivedAt: number; serverOffsetMs: number };

/** [B19-E E1-C review] Why supply signals are not shown: their observations expired, or the result was for another request. */
type SupplyWithheld = "expired" | "stale" | null;

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
  | "lifecycle"
  | "risk"
  | "stock"
  | "unit"
  | "ext";

// ─── Lifecycle presentation ────────────────────────────────────────────────────
const LIFECYCLE_BADGE: Record<LifecycleStatus, { label: string; className: string; tip: string }> = {
  active: {
    label: "Active",
    className: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40",
    tip: "Active — currently in production",
  },
  nrnd: {
    label: "NRND",
    className: "bg-amber-500/15 text-amber-300 border border-amber-500/40",
    tip: "NRND — Not Recommended for New Design; consider alternates",
  },
  last_time_buy: {
    label: "LTB",
    className: "bg-orange-500/15 text-orange-300 border border-orange-500/40",
    tip: "LTB — Last Time Buy; the manufacturer has announced the final date it accepts orders",
  },
  eol: {
    label: "EOL",
    className: "bg-red-500/15 text-red-300 border border-red-500/40",
    tip: "EOL — End of Life; production has ended",
  },
  obsolete: {
    label: "Obsolete",
    className: "bg-zinc-700/40 text-zinc-300 border border-zinc-600/40",
    tip: "Obsolete — no longer available from the manufacturer",
  },
  unknown: {
    label: "Unknown",
    className: "bg-zinc-800/40 text-zinc-500 border border-zinc-700/40",
    tip: "Unknown — no lifecycle data from any distributor",
  },
};

// ─── Risk presentation ─────────────────────────────────────────────────────────
const RISK_GRADE: Record<RiskGrade, { label: string; chip: string; text: string }> = {
  excellent: {
    label: "Excellent",
    chip: "bg-green-500/15 text-green-300 border border-green-500/50",
    text: "text-green-300",
  },
  good: {
    label: "Good",
    chip: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/50",
    text: "text-emerald-300",
  },
  caution: {
    label: "Caution",
    chip: "bg-amber-500/15 text-amber-300 border border-amber-500/50",
    text: "text-amber-300",
  },
  high_risk: {
    label: "High risk",
    chip: "bg-red-500/15 text-red-300 border border-red-500/50",
    text: "text-red-300",
  },
};

function bestUnit(row: BomRow): number | null {
  return lineUnitPrice(row); // [B19-D I5b review] the price the line's quantity reaches — the one the project cost adds up
}
function stockOf(row: BomRow): number | null {
  return row.pricing?.bestOverall?.inStock ?? null;
}
function currencyOf(row: BomRow): string | null {
  return lineCurrency(row);
}
function compareRows(a: BomRow, b: BomRow, key: SortKey, bestWithheld: (row: BomRow) => boolean): number {
  // [B19-E E1-C review] a withheld best offer sorts as no price and no stock, so the order does not reveal them
  const stock = (row: BomRow): number | null => (bestWithheld(row) ? null : stockOf(row));
  const unit = (row: BomRow): number | null => (bestWithheld(row) ? null : bestUnit(row));
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
    case "lifecycle":
      // Most-severe first at the default direction (worst → best).
      return LIFECYCLE_SEVERITY[b.lifecycleStatus] - LIFECYCLE_SEVERITY[a.lifecycleStatus];
    case "risk":
      // Lowest score (highest risk) first at the default direction.
      return a.riskScore.total - b.riskScore.total;
    case "stock":
      return nullLast(stock(a)) - nullLast(stock(b));
    case "unit":
      return nullLast(unit(a)) - nullLast(unit(b));
    case "ext": {
      const ea = unit(a);
      const eb = unit(b);
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
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return "none"; // storage unavailable
  }
  if (stored === "both") stored = "all"; // migrate the legacy persisted value
  // [B19-E E1] a stored choice that is no longer selectable (a source since disabled) is not kept
  return stored !== null && SELECTABLE_CHOICES.has(stored) ? (stored as DistributorChoice) : "none";
}

// ─── Distributor import file helpers ─────────────────────────────────────────--

/** [B19-E E1] Each distributor's import file: the tool it is uploaded to, and the vendor. */
const EXPORT_LABELS: Record<CartDistributor, { tool: string; vendor: string }> = {
  digikey: { tool: "DigiKey BOM Manager", vendor: "DigiKey" },
  mouser: { tool: "Mouser project upload", vendor: "Mouser" },
  lcsc: { tool: "LCSC BOM Tool", vendor: "LCSC" },
};

/** Replace anything outside [A-Za-z0-9-_.] with hyphens for a safe filename. */
function sanitizeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9-_.]+/g, "-").replace(/^-+|-+$/g, "") || "sirkit-bom";
}

function cartSkuOf(row: BomRow, dist: CartDistributor): string | null {
  return row.pricing?.offers.find((o) => o.distributor === dist)?.sku ?? null;
}

/** Whether a row will appear in a distributor's import CSV (mirrors cart-formats). */
function includedInCart(row: BomRow, dist: CartDistributor): boolean {
  if (dist === "lcsc") return !!row.mpn;
  return !!cartSkuOf(row, dist) || !!row.mpn;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Best-effort search URL for a distributor offer (productUrl, else MPN search). */
/** [B19-B I2] shown when there is no project scope to authorize a live-priced BOM request with. */
const BOM_NEEDS_PROJECT = "Open or save a project to build its BOM. Live distributor pricing is a project read.";

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
  const [onlyAtRisk, setOnlyAtRisk] = useState(false);
  // The BOM row whose alternates drawer is open, or null when closed.
  const [drawerRow, setDrawerRow] = useState<BomRow | null>(null);
  // Set just before a "Refresh prices" click so the next fetch bypasses the cache.
  const forceRef = useRef(false);
  // Export-for-distributor menu + sourcing worksheet modal + post-action banners.
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [fileExporting, setFileExporting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  // [B19-E E1] after a distributor import file downloads: stays until dismissed, so the upload link stays reachable
  const [exportNotice, setExportNotice] = useState<{ dist: CartDistributor; mpnOnly: number } | null>(null);
  const [worksheetOpen, setWorksheetOpen] = useState(false);
  // [B19-E E1] a refetch that got no answer: the last result stays, offers past their expiry are not shown
  const [offline, setOffline] = useState(false);
  // [B19-E E1-C review] the pricing choice and design the shown result was for, its arrival and the server clock offset
  const [resultFor, setResultFor] = useState<ResultFor | null>(null);
  // [B19-E E1] the client time offers are judged against (plus the server offset): set when a result arrives, when a
  // refetch fails, and every 30 s while a result is shown
  const [clock, setClock] = useState(0);
  // Snapshots / notifications (Stage 7).
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapPopoverOpen, setSnapPopoverOpen] = useState(false);
  const [snapLabel, setSnapLabel] = useState("");
  const [savingSnap, setSavingSnap] = useState(false);
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [diff, setDiff] = useState<{ fromLabel: string; changes: Change[] } | null>(null);
  const [highlightPartId, setHighlightPartId] = useState<string | null>(null);

  const onSwapPart = props.onSwapPart;
  const onReviewSuccessor = props.onReviewSuccessor; // [B19-E E5]
  // [B19-E E5] hands the line to the page, which opens the component review; nothing is changed from the BOM
  const openSuccessorReview = useCallback((row: BomRow) => { onReviewSuccessor?.(row); }, [onReviewSuccessor]);
  // [B16.0.2 §B] the active project identity is the ONLY key the durable BOM
  // surfaces use, and it travels as a selector — never a content hash.
  const projectScope = props.projectScope ?? null;
  const projectKey = projectScope ? projectScope.projectId : null;
  const selectorHeaders = useMemo(() => projectSelectorHeaders(projectScope), [projectScope]);
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  // Auto-dismiss the post-action banner after 8s.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(t);
  }, [banner]);

  // [B19-E E1-C review] whenever a result is shown, online or offline, the clock advances every 30 s, so an offer that expires
  // meanwhile reads expired and is blanked instead of kept on screen
  const showingResult = result !== null;
  useEffect(() => {
    if (!showingResult) return;
    const t = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [showingResult]);

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
      setResultFor(null);
      setOffline(false);
      return;
    }
    // [B19-B I2] live pricing spends a metered vendor quota, so /api/bom is an authenticated project read: it needs the
    // project scope. Until the scope is known there is nothing to authorize the request with, so nothing is sent, and
    // the view says why instead of showing an empty table.
    if (!projectKey) {
      setResult(null);
      setResultFor(null);
      setOffline(false);
      setError(BOM_NEEDS_PROJECT);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const forceRefresh = forceRef.current;
      let res: Response;
      try {
        res = await fetch("/api/bom", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...selectorHeaders },
          body: JSON.stringify({ state: stateRef.current, pricingChoice, forceRefresh }),
        });
      } catch {
        // [B19-E E1-C review] only a request that got no answer is offline: the last result stays and says so; Retry refetches
        setOffline(true);
        setClock(Date.now());
        return;
      }
      // [B19-E E1-C review] an answer that is not a BOM (an error status, or a body that is not JSON) is an error with its
      // HTTP status, and the last result is not kept as if it were current
      let data: BomResult | { ok: false; error?: unknown } | null;
      try {
        data = (await res.json()) as BomResult | { ok: false; error?: unknown } | null;
      } catch (bodyError) {
        if (!(bodyError instanceof SyntaxError)) {
          // [B19-E E1-C review follow-up] the connection dropped while the answer downloaded: no answer arrived, so offline
          setOffline(true);
          setClock(Date.now());
          return;
        }
        data = null;
      }
      setOffline(false);
      if (res.ok && data !== null && data.ok === true) {
        const receivedAt = Date.now();
        const serverOffsetMs = Number.isFinite(data.generatedAt) ? data.generatedAt - receivedAt : 0;
        setResult(data);
        setResultFor({ pricingChoice, signature, receivedAt, serverOffsetMs });
        setClock(receivedAt);
      } else {
        const message = data !== null && data.ok === false && typeof data.error === "string" ? data.error : "The BOM could not be built";
        setError(`${message} (HTTP ${res.status})`);
        setResult(null);
        setResultFor(null);
      }
    } finally {
      forceRef.current = false; // one-shot — clear after the request settles
      setLoading(false);
    }
    // signature is included so a content change refetches; stateRef carries the
    // live state into the request without retriggering on object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingChoice, signature, refreshNonce, isEmpty, projectKey, selectorHeaders]);

  useEffect(() => {
    void fetchBom();
  }, [fetchBom]);

  const loadSnapshots = useCallback(async () => {
    if (!projectKey) return;
    try {
      const res = await fetch("/api/bom/snapshot", { headers: selectorHeaders });
      const data = (await res.json()) as { ok: boolean; snapshots?: SnapshotMeta[] };
      if (data.ok && data.snapshots) setSnapshots(data.snapshots);
    } catch {
      /* non-fatal */
    }
  }, [projectKey, selectorHeaders]);

  const loadNotifications = useCallback(async () => {
    if (!projectKey) return;
    try {
      const res = await fetch("/api/bom/notifications", { headers: selectorHeaders });
      const data = (await res.json()) as { ok: boolean; notifications?: NotifItem[] };
      if (data.ok && data.notifications) setNotifications(data.notifications);
    } catch {
      /* non-fatal */
    }
  }, [projectKey, selectorHeaders]);

  useEffect(() => {
    void loadSnapshots();
    void loadNotifications();
  }, [loadSnapshots, loadNotifications]);

  const takeSnapshot = async () => {
    if (!projectKey) return;
    setSavingSnap(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...selectorHeaders },
        // selectors + data only — ownership is server-derived
        body: JSON.stringify({
          state: stateRef.current,
          label: snapLabel.trim() || undefined,
          pricingChoice,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Snapshot failed");
      setSnapPopoverOpen(false);
      setSnapLabel("");
      setBanner("Snapshot saved.");
      void loadSnapshots();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Snapshot failed");
    } finally {
      setSavingSnap(false);
    }
  };

  const viewDiff = async (snapshot: SnapshotMeta) => {
    if (!projectKey) return;
    setHistoryOpen(false);
    setError(null);
    try {
      // [B16.0.2 §B] bounded authenticated JSON POST — design state never
      // enters a URL, browser history, proxy log, or analytics query string.
      const res = await fetch("/api/bom/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...selectorHeaders },
        body: JSON.stringify({ from: snapshot.id, to: "current", state: stateRef.current, pricingChoice }),
      });
      const data = (await res.json()) as { ok: boolean; changes?: Change[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Diff failed");
      const label = snapshot.label ?? new Date(snapshot.takenAt).toLocaleString();
      setDiff({ fromLabel: label, changes: data.changes ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diff failed");
    }
  };

  const dismissNotif = async (id: string) => {
    setNotifications((ns) => ns.filter((n) => n.id !== id));
    try {
      await fetch("/api/bom/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...selectorHeaders },
        body: JSON.stringify({ id, dismissedAt: new Date().toISOString() }),
      });
    } catch {
      /* optimistic — already removed locally */
    }
  };

  const markAllRead = async () => {
    if (!projectKey) return;
    setNotifications((ns) => ns.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    try {
      await fetch("/api/bom/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...selectorHeaders },
        body: JSON.stringify({ markAllRead: true }),
      });
    } catch {
      /* optimistic */
    }
  };

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

  // [B19-E E1] Downloads the distributor's import file and nothing else: no page is opened or navigated to, nothing is sent
  // to the vendor and no order is placed. The notice offers the upload page as a link the person clicks.
  const exportForDistributor = async (dist: CartDistributor) => {
    setExportMenuOpen(false);
    setFileExporting(true);
    setExportNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/bom/cart/${dist}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateRef.current, pricingChoice }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      downloadBlob(await res.blob(), `sirkit-bom-${dist}.csv`);
      const mpnOnly = (result?.rows ?? []).filter((r) => includedInCart(r, dist) && !cartSkuOf(r, dist)).length;
      setExportNotice({ dist, mpnOnly });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setFileExporting(false);
    }
  };

  const generateWorksheet = async (form: { title: string; buildQuantity: number; notes: string }) => {
    setFileExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/procurement-packet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateRef.current, pricingChoice, ...form }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(await res.blob(), `sirkit-sourcing-worksheet-${sanitizeFilename(form.title)}-${date}.csv`);
      setWorksheetOpen(false);
      setBanner(`Sourcing worksheet downloaded for ${form.buildQuantity} board${form.buildQuantity === 1 ? "" : "s"}. It is unverified; no order was placed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Worksheet export failed");
    } finally {
      setFileExporting(false);
    }
  };

  // [B19-E E1] an offer past its expiry is blanked instead of served — in the rows, the offers, the sort and the total.
  // [B19-E E1-C review] Judged in server time (the client clock plus the offset at receipt), online or offline; offline, a
  // kept result that was for another pricing choice or design shows no cost, sources or offer prices at all.
  const now = clock + (resultFor?.serverOffsetMs ?? 0);
  const staleRequest = offline && result !== null && (resultFor === null || resultFor.pricingChoice !== pricingChoice || resultFor.signature !== signature);
  const isWithheld = useCallback((offer: PartPricing): boolean => staleRequest || offerWithheld(offer, now, offline), [staleRequest, now, offline]);

  const rows = useMemo(() => {
    if (!result) return [];
    // "At-risk" is now driven by the synthesized risk grade (Stage 5).
    const base = onlyAtRisk
      ? result.rows.filter((r) => r.riskScore.grade === "caution" || r.riskScore.grade === "high_risk")
      : result.rows;
    const bestWithheld = (row: BomRow): boolean => {
      const best = row.pricing?.bestOverall ?? null;
      return best !== null && isWithheld(best);
    };
    return [...base].sort((a, b) => compareRows(a, b, sort.key, bestWithheld) * sort.dir);
  }, [result, sort, onlyAtRisk, isWithheld]);

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
  // [B19-E E1-C review] a kept result for another request shows no source chips
  const sources = staleRequest ? [] : result?.sources ?? [];
  const expiredBest = (row: BomRow): boolean => {
    const best = row.pricing?.bestOverall ?? null;
    return best !== null && isWithheld(best);
  };
  const costHasExpired = (result?.rows ?? []).some(expiredBest);
  // [B19-E E1-C review] online, an offer that expired while shown prompts a refresh; any expiry qualifies the supply signals
  const anyOfferExpired = !staleRequest && (result?.rows ?? []).some((row) => (row.pricing?.offers ?? []).some((o) => offerExpired(o, now)));
  const supplyWithheld: SupplyWithheld = staleRequest ? "stale" : costHasExpired || anyOfferExpired ? "expired" : null;
  // [B19-E E1-C review] the cached and live counts describe the last result while offline or once an offer has expired
  const countsPrefix = offline || anyOfferExpired ? "last result · " : "";
  const receivedAtServer = resultFor ? resultFor.receivedAt + resultFor.serverOffsetMs : null;
  const withheldWord = staleRequest ? "not current" : "expired";
  const exportLabel = exportNotice ? EXPORT_LABELS[exportNotice.dist] : null;
  const uploadHref = exportNotice ? safeHref(DISTRIBUTOR_UPLOAD_URLS[exportNotice.dist], "page", VENDOR_PAGE_HOSTS) : null;

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
            {CHOICE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} disabled={!option.selectable}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {/* Cache freshness badge */}
        {result && pricingChoice !== "none" && (
          <span className="text-[11px] text-zinc-500">
            {countsPrefix}{result.cached} cached · {result.fetched} live
          </span>
        )}

        <label className="flex items-center gap-1.5 text-xs text-zinc-500 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={onlyAtRisk}
            onChange={(e) => setOnlyAtRisk(e.target.checked)}
            className="accent-amber-500"
          />
          At-risk only
        </label>

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

        {/* Export-for-distributor dropdown: files only — nothing is sent and no order is placed */}
        <div className="relative">
          <button
            onClick={() => setExportMenuOpen((v) => !v)}
            disabled={!result || fileExporting}
            className="text-xs px-2 h-7 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
          >
            {fileExporting ? "Exporting…" : "Export for distributor ▾"}
          </button>
          {exportMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setExportMenuOpen(false)} />
              <div className="absolute z-40 left-0 top-full mt-1 w-60 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1 text-xs">
                {(["digikey", "mouser", "lcsc"] as CartDistributor[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => void exportForDistributor(d)}
                    className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 flex items-center justify-between"
                  >
                    <span>{EXPORT_LABELS[d].tool} (CSV)</span>
                    <span className="text-zinc-500">⬇</span>
                  </button>
                ))}
                <div className="my-1 border-t border-zinc-800" />
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    setWorksheetOpen(true);
                  }}
                  className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 flex items-center justify-between"
                >
                  <span>Sourcing worksheet (CSV, unverified)</span>
                  <span className="text-zinc-500">⬇</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Take snapshot */}
        <div className="relative">
          <button
            onClick={() => setSnapPopoverOpen((v) => !v)}
            disabled={!result || !projectKey}
            className="text-xs px-2 h-7 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
          >
            Take snapshot
          </button>
          {snapPopoverOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSnapPopoverOpen(false)} />
              <div className="absolute z-40 left-0 top-full mt-1 w-60 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl p-2.5">
                <label className="block text-[11px] text-zinc-400 mb-2">
                  Label (optional)
                  <input
                    value={snapLabel}
                    onChange={(e) => setSnapLabel(e.target.value)}
                    placeholder="e.g. Pre-EVT"
                    className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-2 h-7 text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                  />
                </label>
                <button
                  onClick={() => void takeSnapshot()}
                  disabled={savingSnap}
                  className="w-full text-xs px-2 h-7 rounded border border-teal-500/40 bg-teal-500/15 text-teal-300 hover:bg-teal-500/25 transition disabled:opacity-50"
                >
                  {savingSnap ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* History */}
        <button
          onClick={() => setHistoryOpen(true)}
          disabled={!projectKey}
          className="text-xs px-2 h-7 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
        >
          History ({snapshots.length})
        </button>

        <div className="ml-auto flex items-center gap-3">
          {/* Notification bell */}
          <button
            onClick={() => setNotifOpen(true)}
            disabled={!projectKey}
            title="Supply-chain notifications"
            className="relative text-sm px-1.5 h-7 rounded text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
          >
            🔔
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-semibold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          <div className="text-xs text-zinc-400">
            {/* [B19-E E1-C review] pricing None never shows a cost; nor does a kept result for another request */}
            {pricingChoice === "none" ? (
              <span className="text-zinc-600">Pricing off</span>
            ) : staleRequest ? (
              <span className="text-zinc-600">Project cost hidden: the last result was for a different request</span>
            ) : costHasExpired ? (
              <span className="text-zinc-600">Project cost hidden: offers expired</span>
            ) : cost && cost.value !== null ? (
              <span>
                Project cost:{" "}
                <span className="font-mono text-teal-300">
                  {cost.value.toFixed(2)} {cost.currency ?? "USD"}
                </span>{" "}
                <span className="text-zinc-600">(qty 1)</span>
              </span>
            ) : (
              <span className="text-zinc-600">No pricing</span>
            )}
          </div>
        </div>
      </div>

      {/* ── [B19-E E1] per-source status chips, from the result's structured sources ── */}
      {sources.length > 0 && (
        <div data-testid="bom-source-chips" className="flex items-center gap-1.5 flex-wrap px-3 py-1.5 border-b border-zinc-800 bg-zinc-950 shrink-0">
          <span className="text-[11px] text-zinc-500 font-medium">Sources</span>
          {sources.map((s) => (
            <span
              key={s.sourceId}
              data-testid="bom-source-chip"
              data-source={s.sourceId}
              data-status={s.status}
              title={[s.freshnessLabel, s.attribution].join(" · ")}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${SOURCE_CHIP_STYLE[s.status]}`}
            >
              {s.displayName} · {sourceStatusText(s)}
            </span>
          ))}
        </div>
      )}

      {/* ── [B19-E E1] offline: the last result stays; offers past their expiry are not shown ── */}
      {offline && (
        <div data-testid="bom-offline" role="status" className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-amber-200 bg-amber-950/30 border-b border-amber-900/40 shrink-0">
          <span className="flex-1">
            {result && receivedAtServer !== null
              ? `Offline — the BOM could not be refreshed. Showing the last result, received ${utcMinute(receivedAtServer)}; offers past their expiry are hidden.`
              : "Offline — the BOM could not be loaded."}
            {/* [B19-E E1-C review] a kept result for another pricing choice or design says so */}
            {staleRequest && " That result was for a different pricing choice or design, so its cost, sources and offer prices are not shown."}
          </span>
          <button
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={loading}
            className="text-[11px] px-2 h-6 rounded border border-amber-700/60 text-amber-200 hover:bg-amber-900/40 transition disabled:opacity-50 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── [B19-E E1-C review] online, an offer expired while shown: it is hidden, and a refresh brings current offers ── */}
      {!offline && anyOfferExpired && (
        <div data-testid="bom-expired" role="status" className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-amber-200 bg-amber-950/30 border-b border-amber-900/40 shrink-0">
          <span className="flex-1">Some offers have expired since this result was received; their price, stock and link are hidden.</span>
          <button
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={loading}
            className="text-[11px] px-2 h-6 rounded border border-amber-700/60 text-amber-200 hover:bg-amber-900/40 transition disabled:opacity-50 shrink-0"
          >
            Get current offers
          </button>
        </div>
      )}

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
      {banner && (
        <div className="flex items-start gap-2 px-3 py-1.5 text-[11px] text-teal-200 bg-teal-950/30 border-b border-teal-900/40 shrink-0">
          <span className="flex-1">{banner}</span>
          <button
            onClick={() => setBanner(null)}
            className="text-teal-400/70 hover:text-teal-200 shrink-0"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {exportNotice && exportLabel && (
        <div data-testid="bom-export-notice" role="status" className="flex items-start gap-2 px-3 py-1.5 text-[11px] text-teal-200 bg-teal-950/30 border-b border-teal-900/40 shrink-0">
          <span className="flex-1">
            {`sirkit-bom-${exportNotice.dist}.csv downloaded for the ${exportLabel.tool}. Nothing was sent to ${exportLabel.vendor} and no order was placed.`}
            {exportNotice.mpnOnly > 0 &&
              ` ${exportNotice.mpnOnly} row${exportNotice.mpnOnly === 1 ? "" : "s"} had no ${exportLabel.vendor} SKU and will be matched by MPN; verify the matches after you upload the file.`}
            {uploadHref && (
              <>
                {" "}
                <a href={uploadHref} target="_blank" rel="noopener noreferrer" className="text-teal-300 underline hover:text-teal-100 whitespace-nowrap">
                  Open {exportLabel.vendor} upload page ↗
                </a>
              </>
            )}
          </span>
          <button
            onClick={() => setExportNotice(null)}
            className="text-teal-400/70 hover:text-teal-200 shrink-0"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Lifecycle summary card ── */}
      {result && result.lifecycleSummary.totalRows > 0 && (
        <LifecycleSummaryCard summary={result.lifecycleSummary} />
      )}

      {/* ── Design risk summary card ── */}
      {result && result.riskSummary.totalRows > 0 && (
        <RiskSummaryCard
          summary={result.riskSummary}
          rows={result.rows}
          supplyWithheld={supplyWithheld}
          onlyAtRisk={onlyAtRisk}
          onToggleAtRisk={() => setOnlyAtRisk((v) => !v)}
        />
      )}

      {/* ── Diff view ── */}
      {diff && (
        <DiffView
          fromLabel={diff.fromLabel}
          changes={diff.changes}
          rows={result?.rows ?? []}
          onJump={(partId) => {
            setHighlightPartId(partId);
            setTimeout(() => setHighlightPartId(null), 3000);
          }}
          onClose={() => setDiff(null)}
        />
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
              <Th sortKey="lifecycle" sort={sort} onSort={toggleSort}>Lifecycle</Th>
              <Th sortKey="risk" sort={sort} onSort={toggleSort}>Risk</Th>
              <Th>Alternates</Th>
              <Th>Best Source</Th>
              <Th sortKey="stock" sort={sort} onSort={toggleSort} className="text-right">Stock</Th>
              <Th sortKey="unit" sort={sort} onSort={toggleSort} className="text-right">Unit Price</Th>
              <Th sortKey="ext" sort={sort} onSort={toggleSort} className="text-right">Ext. Price</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {rows.map((row, i) => {
              // [B19-E E1] past its expiry (online or offline), or offline for another request: price, stock and link are not shown
              const expired = expiredBest(row);
              const unit = expired ? null : bestUnit(row);
              const currency = currencyOf(row);
              const stock = expired ? null : stockOf(row);
              const url = expired ? null : vendorProductPageUrl(row.pricing?.bestOverall?.productUrl);
              const hasPricing = pricingChoice !== "none" && row.pricing !== null;
              const offers = row.pricing?.offers ?? [];
              const best = row.pricing?.bestOverall ?? null;
              // [B19-E E1-C review follow-up] keyed by the row's references, not its position: a clock tick that re-sorts keeps expansion
              const rowKey = `${row.partId ?? row.name}|${row.value ?? ""}|${row.refDesList.join(",")}`;
              const isExpandable = hasPricing && offers.length > 0; // [B19-E E1-C review] pricing None opens no offers
              const isOpen = isExpandable && expanded.has(rowKey);
              return (
                <Fragment key={rowKey}>
                  <tr
                    className={`hover:bg-zinc-900/50 ${isExpandable ? "cursor-pointer" : ""} ${
                      row.partId && row.partId === highlightPartId ? "ring-1 ring-inset ring-teal-400/70 bg-teal-500/10" : ""
                    }`}
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
                      {/* [B19-E E5] a withdrawn or unpublished atomic revision says so; a named successor can be reviewed (OD-38) */}
                      {row.catalogStatus && row.catalogStatus.state !== "published" && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          <CatalogStatusBadge status={row.catalogStatus} />
                          {onReviewSuccessor && row.catalogStatus.successorRevisionId && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openSuccessorReview(row);
                              }}
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-300 border border-sky-500/40 hover:bg-sky-500/25 transition"
                              title="Open the component review to preview the successor and rebind (a reviewer's act)"
                            >
                              Review successor
                            </button>
                          )}
                        </div>
                      )}
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
                    <Td>
                      <LifecycleBadge status={row.lifecycleStatus} />
                    </Td>
                    <Td>
                      <RiskBadge row={row} isWithheld={isWithheld} withheldWord={withheldWord} />
                    </Td>
                    <Td>
                      {row.alternatesCount > 0 ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawerRow(row);
                          }}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/15 text-teal-300 border border-teal-500/40 hover:bg-teal-500/25 transition"
                          title="View alternate parts"
                        >
                          {row.alternatesCount} alt{row.alternatesCount > 1 ? "s" : ""}
                        </button>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {hasPricing && best && expired ? (
                        <span>
                          <span className="text-zinc-300">{distributorLabel(best.distributor)}</span>
                          <span className="text-zinc-600"> · {withheldWord}</span>
                        </span>
                      ) : hasPricing && best ? (
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
                          <Muted>{expired ? withheldWord : "no pricing"}</Muted>
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
                      <td className="px-3 py-2 border-b border-zinc-800/70" colSpan={16}>
                        <OfferDetail offers={offers} bestDistributor={best?.distributor ?? null} now={now} isWithheld={isWithheld} offline={offline} staleRequest={staleRequest} />
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
          ? `${countsPrefix}${result.rows.length} line item${result.rows.length === 1 ? "" : "s"} · ${result.cached} cached · ${result.fetched} live`
          : "—"}
      </div>

      {drawerRow && drawerRow.partId && (
        <AlternatesDrawer
          sourcePartId={drawerRow.partId}
          sourceLabel={alternatesDrawerLabel(drawerRow)}
          onSwapPart={onSwapPart}
          onClose={() => setDrawerRow(null)}
        />
      )}

      {worksheetOpen && (
        <SourcingWorksheetModal
          busy={fileExporting}
          onGenerate={generateWorksheet}
          onClose={() => setWorksheetOpen(false)}
        />
      )}

      {historyOpen && (
        <HistoryPanel
          snapshots={snapshots}
          onViewDiff={(s) => void viewDiff(s)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {notifOpen && (
        <NotificationsDrawer
          notifications={notifications}
          onDismiss={(id) => void dismissNotif(id)}
          onMarkAllRead={() => void markAllRead()}
          onClose={() => setNotifOpen(false)}
        />
      )}
    </div>
  );
}

/** "R7 — 10kΩ 0805" style heading for the alternates drawer. */
function alternatesDrawerLabel(row: BomRow): string {
  const parts = [row.refDes || row.name];
  const detail = [row.value, row.package].filter((x): x is string => !!x).join(" ");
  if (detail) parts.push(detail);
  return parts.join(" — ");
}

// ─── Sourcing worksheet modal ───────────────────────────────────────────────--

/** [B19-E E1] A sourcing worksheet to review with a buyer or a contract manufacturer — not verified procurement, never an order. */
function SourcingWorksheetModal({
  busy,
  onGenerate,
  onClose,
}: {
  busy: boolean;
  onGenerate: (form: { title: string; buildQuantity: number; notes: string }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("sirkit BOM");
  const [buildQty, setBuildQty] = useState("1");
  const [notes, setNotes] = useState("");

  const qtyNum = Math.max(1, Math.floor(Number(buildQty) || 0));
  const canGenerate = title.trim() !== "" && !busy;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-[380px] max-w-full rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl p-4">
        <div className="text-sm font-medium text-zinc-100 mb-1">Sourcing worksheet (CSV, unverified)</div>
        <div className="text-[11px] text-zinc-500 mb-3">
          Priced from cached offers, each with its source and when it was observed. Not verified procurement; no order is placed.
        </div>

        <label className="block text-[11px] text-zinc-400 mb-2">
          Project title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded px-2 h-7 text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
          />
        </label>

        <label className="block text-[11px] text-zinc-400 mb-2">
          Build quantity
          <input
            type="number"
            min={1}
            value={buildQty}
            onChange={(e) => setBuildQty(e.target.value)}
            className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded px-2 h-7 text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
          />
        </label>

        <label className="block text-[11px] text-zinc-400 mb-1">
          Notes (optional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-teal-500 resize-none"
          />
        </label>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="text-xs px-3 h-7 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onGenerate({ title: title.trim(), buildQuantity: qtyNum, notes })}
            disabled={!canGenerate}
            className="text-xs px-3 h-7 rounded border border-teal-500/40 bg-teal-500/15 text-teal-300 hover:bg-teal-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "Generating…" : "Generate worksheet"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Snapshot diff view ─────────────────────────────────────────────────────--

function DiffView({
  fromLabel,
  changes,
  rows,
  onJump,
  onClose,
}: {
  fromLabel: string;
  changes: Change[];
  rows: BomRow[];
  onJump: (partId: string) => void;
  onClose: () => void;
}) {
  const rowByPart = new Map(rows.filter((r) => r.partId).map((r) => [r.partId as string, r]));
  return (
    <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-950 shrink-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-zinc-200">Changes since {fromLabel}</span>
        <button
          onClick={onClose}
          className="ml-auto text-[11px] px-2 h-6 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800"
        >
          Close diff
        </button>
      </div>
      {changes.length === 0 ? (
        <div className="text-[11px] text-zinc-500">No supply-chain changes since this snapshot.</div>
      ) : (
        <ul className="space-y-1">
          {changes.map((c, i) => {
            const row = rowByPart.get(c.partId);
            const draft = changeToNotification(c, {
              mpn: row?.mpn ?? null,
              manufacturer: row?.manufacturer ?? null,
              refDesList: row?.refDesList ?? [],
            });
            const sev = SEVERITY_STYLE[draft.severity];
            return (
              <li key={i} className="flex items-center gap-2 text-[11px]">
                <span className={sev.className}>{sev.glyph}</span>
                <span className="text-zinc-300 flex-1">{draft.summary}</span>
                {row && (
                  <button onClick={() => onJump(c.partId)} className="text-teal-400 hover:underline shrink-0">
                    Jump to part
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Snapshot history panel ─────────────────────────────────────────────────--

function HistoryPanel({
  snapshots,
  onViewDiff,
  onClose,
}: {
  snapshots: SnapshotMeta[];
  onViewDiff: (s: SnapshotMeta) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-[380px] max-w-full h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-zinc-800 shrink-0">
          <div className="text-sm text-zinc-200 font-medium">Snapshot history</div>
          <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200 text-lg leading-none">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {snapshots.length === 0 ? (
            <div className="text-xs text-zinc-500 text-center py-8">
              No snapshots yet. Click &ldquo;Take snapshot&rdquo; to capture the current BOM.
            </div>
          ) : (
            snapshots.map((s) => (
              <div key={s.id} className="border border-zinc-800 rounded-md p-2.5 bg-zinc-900/40">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-zinc-100 font-medium truncate">{s.label ?? "Untitled snapshot"}</div>
                    <div className="text-[10px] text-zinc-500">{new Date(s.takenAt).toLocaleString()}</div>
                  </div>
                  <button
                    onClick={() => onViewDiff(s)}
                    className="text-[11px] px-2 h-6 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 shrink-0"
                  >
                    View diff
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-500">
                  <span>{s.rowCount} parts</span>
                  <span>
                    {s.totalCostCents !== null
                      ? `${(s.totalCostCents / 100).toFixed(2)} ${s.currency ?? "USD"}`
                      : "—"}
                  </span>
                  <span>risk {s.designRiskScore}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Notifications drawer ───────────────────────────────────────────────────--

function NotificationsDrawer({
  notifications,
  onDismiss,
  onMarkAllRead,
  onClose,
}: {
  notifications: NotifItem[];
  onDismiss: (id: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-[380px] max-w-full h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-zinc-800 shrink-0">
          <div className="text-sm text-zinc-200 font-medium">Notifications</div>
          <button
            onClick={onMarkAllRead}
            className="ml-auto text-[11px] px-2 h-6 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800"
          >
            Mark all as read
          </button>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {notifications.length === 0 ? (
            <div className="text-xs text-zinc-500 text-center py-8">No notifications.</div>
          ) : (
            notifications.map((n) => {
              const sev = SEVERITY_STYLE[n.severity];
              return (
                <div
                  key={n.id}
                  className={`border rounded-md p-2.5 ${n.readAt ? "border-zinc-800 bg-zinc-900/30" : "border-zinc-700 bg-zinc-900/60"}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`${sev.className} shrink-0`}>{sev.glyph}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-zinc-200">{n.summary}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{relativeTime(n.createdAt)}</div>
                    </div>
                    <button
                      onClick={() => onDismiss(n.id)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-200 shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Alternates drawer ──────────────────────────────────────────────────────--

type AlternateKind = "exact" | "drop_in" | "fff" | "substitute";

type AlternateItem = {
  partId: string;
  name: string;
  mpn: string | null;
  manufacturer: string | null;
  package: string | null;
  lifecycleStatus: LifecycleStatus;
  stock: number | null;
  bestPrice: { value: number; currency: string } | null;
  kind: AlternateKind;
  score: number;
  matchReasons: string[];
};

type AlternatesResponse =
  | { ok: true; alternates: AlternateItem[] }
  | { ok: false; error: string };

function AlternatesDrawer({
  sourcePartId,
  sourceLabel,
  onSwapPart,
  onClose,
}: {
  sourcePartId: string;
  sourceLabel: string;
  onSwapPart?: (sourcePartId: string, newPartId: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<AlternateItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDropIn, setShowDropIn] = useState(true);
  const [showFff, setShowFff] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/parts/${sourcePartId}/alternates?kind=all&limit=50`)
      .then((res) => res.json() as Promise<AlternatesResponse>)
      .then((data) => {
        if (cancelled) return;
        if (data.ok) setItems(data.alternates);
        else setError(data.error);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load alternates");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourcePartId]);

  const visible = (items ?? []).filter(
    (a) => (a.kind === "drop_in" && showDropIn) || (a.kind === "fff" && showFff) || (a.kind !== "drop_in" && a.kind !== "fff"),
  );

  return (
    <div className="absolute inset-0 z-20 flex" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />
      {/* Panel */}
      <div className="w-[420px] max-w-full h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-zinc-800 shrink-0">
          <div className="text-sm text-zinc-200 font-medium truncate">Alternates for {sourceLabel}</div>
          <button
            onClick={onClose}
            className="ml-auto text-zinc-500 hover:text-zinc-200 text-lg leading-none"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Kind filter */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 shrink-0">
          <KindToggle label="Drop-in" active={showDropIn} onClick={() => setShowDropIn((v) => !v)} />
          <KindToggle label="FFF" active={showFff} onClick={() => setShowFff((v) => !v)} />
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-500">
              <Spinner /> Loading alternates…
            </div>
          )}
          {error && <div className="text-[11px] text-red-300">{error}</div>}
          {!loading && !error && visible.length === 0 && (
            <div className="text-xs text-zinc-500 text-center py-8">No alternates found for this part.</div>
          )}
          {visible.map((alt) => (
            <AlternateCard
              key={alt.partId}
              alt={alt}
              canSwap={!!onSwapPart}
              onSwap={() => {
                onSwapPart?.(sourcePartId, alt.partId);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function KindToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 h-6 rounded border transition ${
        active
          ? "bg-teal-500/15 text-teal-300 border-teal-500/40"
          : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}

function AlternateCard({
  alt,
  canSwap,
  onSwap,
}: {
  alt: AlternateItem;
  canSwap: boolean;
  onSwap: () => void;
}) {
  const kindLabel = alt.kind === "drop_in" ? "Drop-in" : alt.kind === "fff" ? "FFF" : alt.kind;
  return (
    <div className="border border-zinc-800 rounded-md p-2.5 bg-zinc-900/40">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-zinc-100 text-xs truncate">{alt.mpn ?? alt.name}</div>
          <div className="text-[10px] text-zinc-500 truncate">{alt.manufacturer ?? "Unknown manufacturer"}</div>
        </div>
        <button
          onClick={onSwap}
          disabled={!canSwap}
          title={canSwap ? "Replace the source part with this alternate" : "Swap wiring pending — see roadmap"}
          className="shrink-0 text-[11px] px-2 h-6 rounded border border-teal-500/40 bg-teal-500/15 text-teal-300 hover:bg-teal-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Swap
        </button>
      </div>

      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{kindLabel}</span>
        {alt.package && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{alt.package}</span>
        )}
        <LifecycleBadge status={alt.lifecycleStatus} />
      </div>

      {/* Score bar */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-teal-400"
            style={{ width: `${Math.max(0, Math.min(100, alt.score))}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-zinc-400 w-7 text-right">{alt.score}</span>
      </div>

      {alt.matchReasons.length > 0 && (
        <div className="mt-1 text-[10px] text-zinc-500">{alt.matchReasons.join(" · ")}</div>
      )}

      <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>{alt.stock !== null ? `${alt.stock.toLocaleString()} in stock` : "stock —"}</span>
        <span className="font-mono">
          {alt.bestPrice ? `${alt.bestPrice.value.toFixed(alt.bestPrice.value < 1 ? 4 : 2)} ${alt.bestPrice.currency}` : "—"}
        </span>
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

/** [B19-E E5] the words for a line's atomic revision status (OD-38); published lines show no badge */
const CATALOG_STATUS_BADGE: Record<Exclude<BomCatalogStatus["state"], "published">, { label: string; tip: string; className: string }> = {
  deprecated: { label: "Deprecated revision", tip: "Deprecated atomic revision: existing pins keep working, but it is excluded from new selection and binding.", className: "bg-amber-500/15 text-amber-300 border border-amber-500/40" },
  superseded: { label: "Superseded revision", tip: "Superseded atomic revision: existing pins keep working; a successor revision replaces it for new selection and binding.", className: "bg-amber-500/15 text-amber-300 border border-amber-500/40" },
  revoked: { label: "Revoked revision", tip: "Revoked atomic revision: it fails closed — no exact authority, no PCB sync and no export until the line moves to another revision.", className: "bg-red-500/15 text-red-300 border border-red-500/40" },
  unpublished: { label: "Unpublished revision", tip: "The atomic revision this line names is not published in the catalog.", className: "bg-zinc-800 text-zinc-300 border border-zinc-700" },
  unavailable: { label: "Revision status unavailable", tip: "The atomic revision status could not be read; try again.", className: "bg-zinc-800 text-zinc-400 border border-zinc-700" },
};

function CatalogStatusBadge({ status }: { status: BomCatalogStatus }) {
  if (status.state === "published") return null;
  const badge = CATALOG_STATUS_BADGE[status.state];
  return (
    <span data-testid="bom-catalog-status" title={badge.tip} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${badge.className}`}>
      {badge.label}
    </span>
  );
}

function LifecycleBadge({ status }: { status: LifecycleStatus }) {
  const b = LIFECYCLE_BADGE[status];
  return (
    <span
      title={b.tip}
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${b.className}`}
    >
      {b.label}
    </span>
  );
}

const RISK_TEXT: Record<BomLifecycleSummary["riskRecommendation"], { label: string; className: string }> = {
  ok: { label: "All clear", className: "text-emerald-400" },
  review: { label: "Review recommended", className: "text-amber-400" },
  blocked: { label: "Production blocked", className: "text-red-400" },
};

const LIFECYCLE_ORDER: LifecycleStatus[] = [
  "active",
  "nrnd",
  "last_time_buy",
  "eol",
  "obsolete",
  "unknown",
];

function LifecycleSummaryCard({ summary }: { summary: BomLifecycleSummary }) {
  const chips = LIFECYCLE_ORDER.filter((s) => summary[s] > 0);
  const rec = RISK_TEXT[summary.riskRecommendation];
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950 shrink-0">
      <span className="text-[11px] text-zinc-500 font-medium">Lifecycle</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {chips.length > 0 ? (
          chips.map((s) => {
            const b = LIFECYCLE_BADGE[s];
            return (
              <span
                key={s}
                title={b.tip}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${b.className}`}
              >
                {summary[s]} {b.label}
              </span>
            );
          })
        ) : (
          <span className="text-[11px] text-zinc-600">No parts</span>
        )}
      </div>
      <span className={`ml-auto text-[11px] font-medium ${rec.className}`}>{rec.label}</span>
    </div>
  );
}

// ─── Risk badge + breakdown popover ─────────────────────────────────────────--

function RiskBadge({ row, isWithheld, withheldWord }: { row: BomRow; isWithheld: (offer: PartPricing) => boolean; withheldWord: string }) {
  const risk = row.riskScore;
  const g = RISK_GRADE[risk.grade];

  // [B19-E E1] an offer that is not shown (expired, or offline for another request) is not counted into the breakdown
  const allOffers = row.pricing?.offers ?? [];
  const offers = allOffers.filter((o) => !isWithheld(o));
  const hasData = row.pricing !== null;
  const allExpired = offers.length === 0 && allOffers.length > 0;
  const totalStock = offers.reduce((s, o) => s + (o.inStock ?? 0), 0);
  const suppliers = new Set(offers.filter((o) => (o.inStock ?? 0) > 0).map((o) => o.distributor)).size;
  // [B19-E E1-C review] priced only by an offer still shown; a price that is only in withheld offers says why
  const hasPrice = offers.some((o) => o.bestUnitPrice !== null);
  const priceWithheld = !hasPrice && allOffers.some((o) => o.bestUnitPrice !== null);

  return (
    <span className="relative inline-block group">
      <span
        className={`inline-flex items-center justify-center min-w-[26px] px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums cursor-default ${g.chip}`}
      >
        {risk.total}
      </span>
      {/* Hover breakdown */}
      <div className="hidden group-hover:block absolute z-30 left-0 top-full mt-1 w-60 p-2.5 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl text-left">
        <div className="text-[11px] font-medium text-zinc-200 mb-1.5">
          Risk: {risk.total} / 100 <span className={g.text}>({g.label})</span>
        </div>
        <div className="space-y-0.5 text-[10px]">
          <BreakdownLine label="Lifecycle" pts={risk.components.lifecycle} max={35} note={row.lifecycleStatus} />
          <BreakdownLine
            label="Availability"
            pts={risk.components.availability}
            max={30}
            note={allExpired ? withheldWord : hasData ? `${totalStock.toLocaleString()} units` : "no data"}
          />
          <BreakdownLine
            label="Supplier mix"
            pts={risk.components.diversity}
            max={20}
            note={allExpired ? withheldWord : hasData ? `${suppliers} supplier${suppliers === 1 ? "" : "s"}` : "no data"}
          />
          <BreakdownLine
            label="Pricing"
            pts={risk.components.pricing}
            max={15}
            note={hasPrice ? "priced" : priceWithheld ? withheldWord : hasData ? "no price" : "no data"}
          />
        </div>
        {risk.notes.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-zinc-800">
            <div className="text-[10px] text-zinc-500 mb-0.5">Notes</div>
            <ul className="text-[10px] text-zinc-400 space-y-0.5">
              {risk.notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </span>
  );
}

function BreakdownLine({ label, pts, max, note }: { label: string; pts: number; max: number; note: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-zinc-400">
      <span className="w-20 text-zinc-500">{label}</span>
      <span className="text-zinc-300 tabular-nums w-12">
        {pts} / {max}
      </span>
      <span className="text-zinc-600 truncate">({note})</span>
    </div>
  );
}

// ─── Design risk summary card ───────────────────────────────────────────────--

/** [B19-E E1-C review] What replaces the supply signals when the observations behind them are not shown. */
const SUPPLY_WITHHELD: Record<Exclude<SupplyWithheld, null>, { badge: string; note: string }> = {
  expired: { badge: "Observations expired", note: "Supply signals are not shown: observations behind them have expired. Refresh prices for current offers." },
  stale: { badge: "Observations not current", note: "Supply signals are not shown: the last result was for a different pricing choice or design." },
};

function RiskSummaryCard({
  summary,
  rows,
  supplyWithheld,
  onlyAtRisk,
  onToggleAtRisk,
}: {
  summary: DesignRiskSummary;
  rows: BomRow[];
  /** [B19-E E1-C review] expired or other-request observations: no "Supply signals OK" badge or recommendation */
  supplyWithheld: SupplyWithheld;
  onlyAtRisk: boolean;
  onToggleAtRisk: () => void;
}) {
  const withheld = supplyWithheld ? SUPPLY_WITHHELD[supplyWithheld] : null;
  const g = RISK_GRADE[summary.overallGrade];
  const showConcerns = summary.overallGrade === "caution" || summary.overallGrade === "high_risk";
  const concerns = showConcerns
    ? [...rows]
        .sort(
          (a, b) =>
            a.riskScore.total - b.riskScore.total ||
            (a.refDesList[0] ?? a.refDes).localeCompare(b.refDesList[0] ?? b.refDes),
        )
        .slice(0, 3)
    : [];

  return (
    <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-950 shrink-0">
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center justify-center w-11 h-11 rounded-full text-sm font-semibold tabular-nums shrink-0 ${g.chip}`}
        >
          {summary.overallScore}
        </span>
        <div className="min-w-0">
          <div className="text-xs text-zinc-200 font-medium">
            Risk: {summary.overallScore} / 100 <span className={g.text}>({g.label})</span>
            {summary.rowsAtRisk > 0 && (
              <span className="text-zinc-500">
                {" · "}
                {summary.rowsAtRisk} row{summary.rowsAtRisk === 1 ? "" : "s"} at risk
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400">{withheld ? withheld.note : summary.recommendation}</div>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {withheld ? (
            <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800/60 text-zinc-400 border border-zinc-700 font-medium">
              {withheld.badge}
            </span>
          ) : summary.productionReady && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/15 text-green-300 border border-green-500/50 font-medium">
              Supply signals OK (observed)
            </span>
          )}
          <button
            onClick={onToggleAtRisk}
            className={`text-[11px] px-2 h-7 rounded border transition ${
              onlyAtRisk
                ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                : "border-zinc-800 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {onlyAtRisk ? "Showing at-risk" : "View at-risk parts"}
          </button>
        </div>
      </div>

      {concerns.length > 0 && (
        <div className="mt-2 pl-14">
          <div className="text-[10px] text-zinc-500 mb-1">Top concerns</div>
          <ul className="space-y-0.5">
            {concerns.map((r) => {
              const rg = RISK_GRADE[r.riskScore.grade];
              return (
                <li key={`${r.partId ?? r.name}|${r.value ?? ""}`} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-zinc-300 w-12 shrink-0 truncate">{r.refDesList[0] ?? r.refDes}</span>
                  <span className="text-zinc-500 w-20 shrink-0 truncate">{r.value ?? r.mpn ?? r.name}</span>
                  <span className={`tabular-nums font-mono w-6 text-right ${rg.text}`}>{r.riskScore.total}</span>
                  <span className="text-zinc-500 truncate">● {r.riskScore.notes.join(", ")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** [B19-E E1] When an observation expires, in words: a no-storage source's offer is never kept. */
function offerExpiryText(offer: PartPricing, now: number): string {
  const freshness = offerFreshness(offer, now);
  if (!freshness) return "—";
  if ((sourceLabel(offer.distributor)?.servedForMs ?? 0) <= 0) return "not kept (terms prohibit storing it)";
  return freshness.servable ? utcMinute(freshness.expiresAt) : `expired ${utcMinute(freshness.expiresAt)}`;
}

/** Per-source breakdown shown when a BOM row is expanded. */
function OfferDetail({
  offers,
  bestDistributor,
  now,
  isWithheld,
  offline,
  staleRequest,
}: {
  offers: PartPricing[];
  bestDistributor: string | null;
  /** [B19-E E1-C review] server time */
  now: number;
  /** [B19-E E1] an offer past its expiry (online or offline), or offline one never kept, is blanked, not served */
  isWithheld: (offer: PartPricing) => boolean;
  offline: boolean;
  /** [B19-E E1-C review] offline, the kept result was for a different pricing choice or design */
  staleRequest: boolean;
}) {
  const withheldText = (offer: PartPricing): string =>
    staleRequest
      ? "not shown — this result was for a different pricing choice or design"
      : offerExpired(offer, now)
        ? `expired — its price, stock and link are not shown${offline ? " while offline" : "; refresh prices for a current offer"}`
        : "not kept — its price, stock and link are not shown while offline";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-zinc-500">
            <th className="text-left font-medium px-2 py-1">Distributor</th>
            <th className="text-left font-medium px-2 py-1">Basis</th>
            <th className="text-left font-medium px-2 py-1">Observed</th>
            <th className="text-left font-medium px-2 py-1">Expires</th>
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
            const freshness = offerFreshness(o, now);
            const expired = isWithheld(o);
            return (
              <tr key={`${o.distributor}:${idx}`} data-testid="bom-offer" data-distributor={o.distributor} className={isBest ? "text-zinc-100" : ""}>
                <td className="px-2 py-1">
                  {distributorLabel(o.distributor)}
                  {isBest && (
                    <span className="text-amber-400" title="best price">
                      {" "}
                      ★
                    </span>
                  )}
                </td>
                <td className="px-2 py-1" data-testid="offer-basis">
                  {freshness ? freshness.basis : "—"}
                </td>
                <td className="px-2 py-1 whitespace-nowrap" data-testid="offer-observed">
                  {freshness ? utcMinute(freshness.retrievedAt) : "—"}
                </td>
                <td className="px-2 py-1 whitespace-nowrap" data-testid="offer-expires">
                  {offerExpiryText(o, now)}
                </td>
                {expired ? (
                  <td className="px-2 py-1 text-zinc-500" colSpan={7}>
                    {withheldText(o)}
                  </td>
                ) : (
                  <>
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
                      {(() => {
                        const url = offerLinkUrl(o);
                        return url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-teal-400 hover:underline whitespace-nowrap"
                          >
                            View on {distributorLabel(o.distributor)} ↗
                          </a>
                        ) : (
                          <span className="text-zinc-700">↗</span>
                        );
                      })()}
                    </td>
                  </>
                )}
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
