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
import type { BomRow, BomResult, BomLifecycleSummary } from "@/app/lib/bom/build";
import { LIFECYCLE_SEVERITY } from "@/app/lib/distributors/shared";
import type { DistributorChoice, PartPricing, LifecycleStatus } from "@/app/lib/distributors/shared";
import type { RiskGrade, DesignRiskSummary } from "@/app/lib/risk-scoring";
import {
  DISTRIBUTOR_UPLOAD_URLS,
  digiKeyProductUrl,
  mouserProductUrl,
  lcscProductUrl,
  type CartDistributor,
} from "@/app/lib/distributor-links";
import type { Change } from "@/app/lib/snapshots";
import { changeToNotification, type NotificationSeverity } from "@/app/lib/notifications";

type Props = (
  | { state: SchematicState }
  | { components: SchComponent[]; kicadComponents: KicadComponentInstance[] }
) & {
  /** Caller-provided project id; defaults to a SHA-256 hash of the state. */
  projectKey?: string;
  /**
   * Called when the user clicks "Swap" on an alternate. The parent (page.tsx)
   * implements the schematic-state mutation. When undefined, Swap is disabled.
   */
  onSwapPart?: (sourcePartId: string, newPartId: string) => void;
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
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = o[k];
          return acc;
        }, {});
    }
    return v;
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
    tip: "LTB — Last Time Buy; the manufacturer has announced final purchase orders",
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
    case "lifecycle":
      // Most-severe first at the default direction (worst → best).
      return LIFECYCLE_SEVERITY[b.lifecycleStatus] - LIFECYCLE_SEVERITY[a.lifecycleStatus];
    case "risk":
      // Lowest score (highest risk) first at the default direction.
      return a.riskScore.total - b.riskScore.total;
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

// ─── Cart export helpers ────────────────────────────────────────────────────--

const CART_LABELS: Record<CartDistributor, { full: string; short: string }> = {
  digikey: { full: "DigiKey BOM Manager", short: "DigiKey" },
  mouser: { full: "Mouser Project Cart", short: "Mouser" },
  lcsc: { full: "LCSC BOM Tool", short: "LCSC" },
};

/** Replace anything outside [A-Za-z0-9-_.] with hyphens for a safe filename. */
function sanitizeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9-_.]+/g, "-").replace(/^-+|-+$/g, "") || "sirkit-bom";
}

function cartSkuOf(row: BomRow, dist: CartDistributor): string | null {
  return row.pricing?.offers.find((o) => o.distributor === dist)?.sku ?? null;
}

/** Whether a row will appear in a distributor's cart CSV (mirrors cart-formats). */
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
function searchUrlFor(offer: PartPricing): string | null {
  if (offer.productUrl) return offer.productUrl;
  const id = offer.sku ?? offer.mpn;
  if (!id) return null;
  if (offer.distributor === "digikey") return digiKeyProductUrl(id);
  if (offer.distributor === "mouser") return mouserProductUrl(id);
  if (offer.distributor === "lcsc") return lcscProductUrl(id);
  return null;
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
  const [onlyAtRisk, setOnlyAtRisk] = useState(false);
  // The BOM row whose alternates drawer is open, or null when closed.
  const [drawerRow, setDrawerRow] = useState<BomRow | null>(null);
  // Set just before a "Refresh prices" click so the next fetch bypasses the cache.
  const forceRef = useRef(false);
  // Send-to dropdown + procurement modal + post-action banner.
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [packetOpen, setPacketOpen] = useState(false);
  // Snapshots / notifications (Stage 7).
  const [hashedKey, setHashedKey] = useState<string | null>(null);
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
  const projectKey = props.projectKey ?? hashedKey;
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  // Auto-dismiss the post-action banner after 8s.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(t);
  }, [banner]);

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

  // ── Project key: explicit prop, else a SHA-256 hash of the state ──
  useEffect(() => {
    if (props.projectKey) return; // explicit key — no hash needed
    let cancelled = false;
    void sha256Hex(stableStringify(stateRef.current)).then((h) => {
      if (!cancelled) setHashedKey(h);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectKey, signature]);

  const loadSnapshots = useCallback(async () => {
    if (!projectKey) return;
    try {
      const res = await fetch(`/api/bom/snapshot?projectKey=${encodeURIComponent(projectKey)}`);
      const data = (await res.json()) as { ok: boolean; snapshots?: SnapshotMeta[] };
      if (data.ok && data.snapshots) setSnapshots(data.snapshots);
    } catch {
      /* non-fatal */
    }
  }, [projectKey]);

  const loadNotifications = useCallback(async () => {
    if (!projectKey) return;
    try {
      const res = await fetch(`/api/bom/notifications?projectKey=${encodeURIComponent(projectKey)}`);
      const data = (await res.json()) as { ok: boolean; notifications?: NotifItem[] };
      if (data.ok && data.notifications) setNotifications(data.notifications);
    } catch {
      /* non-fatal */
    }
  }, [projectKey]);

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: stateRef.current,
          projectKey,
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
      const stateB64 = btoa(unescape(encodeURIComponent(JSON.stringify(stateRef.current))));
      const qs = new URLSearchParams({
        from: snapshot.id,
        to: "current",
        projectKey,
        state: stateB64,
        pricingChoice,
      });
      const res = await fetch(`/api/bom/diff?${qs.toString()}`);
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectKey, markAllRead: true }),
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

  const sendToDistributor = async (dist: CartDistributor) => {
    setSendOpen(false);
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/bom/cart/${dist}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateRef.current, pricingChoice }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      downloadBlob(await res.blob(), `sirkit-bom-${dist}.csv`);
      window.open(DISTRIBUTOR_UPLOAD_URLS[dist], "_blank", "noopener,noreferrer");

      const { full, short } = CART_LABELS[dist];
      const mpnOnly = (result?.rows ?? []).filter((r) => includedInCart(r, dist) && !cartSkuOf(r, dist)).length;
      let msg = `CSV downloaded as sirkit-bom-${dist}.csv. The ${full} just opened — upload the file there to populate your cart.`;
      if (mpnOnly > 0) {
        msg += ` ${mpnOnly} row${mpnOnly === 1 ? "" : "s"} had no ${short} SKU and will be matched by MPN. Verify the matches after upload.`;
      }
      setBanner(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send-to failed");
    } finally {
      setSending(false);
    }
  };

  const generatePacket = async (form: { title: string; buildQuantity: number; notes: string }) => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/procurement-packet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateRef.current, pricingChoice, ...form }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(await res.blob(), `sirkit-procurement-${sanitizeFilename(form.title)}-${date}.csv`);
      setPacketOpen(false);
      setBanner(`Procurement packet downloaded for ${form.buildQuantity} board${form.buildQuantity === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Packet export failed");
    } finally {
      setSending(false);
    }
  };

  const rows = useMemo(() => {
    if (!result) return [];
    // "At-risk" is now driven by the synthesized risk grade (Stage 5).
    const base = onlyAtRisk
      ? result.rows.filter((r) => r.riskScore.grade === "caution" || r.riskScore.grade === "high_risk")
      : result.rows;
    return [...base].sort((a, b) => compareRows(a, b, sort.key) * sort.dir);
  }, [result, sort, onlyAtRisk]);

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

        {/* Send-to dropdown */}
        <div className="relative">
          <button
            onClick={() => setSendOpen((v) => !v)}
            disabled={!result || sending}
            className="text-xs px-2 h-7 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send to ▾"}
          </button>
          {sendOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSendOpen(false)} />
              <div className="absolute z-40 left-0 top-full mt-1 w-52 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1 text-xs">
                {(["digikey", "mouser", "lcsc"] as CartDistributor[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => void sendToDistributor(d)}
                    className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 flex items-center justify-between"
                  >
                    <span>{CART_LABELS[d].full}</span>
                    <span className="text-zinc-500">↗</span>
                  </button>
                ))}
                <div className="my-1 border-t border-zinc-800" />
                <button
                  onClick={() => {
                    setSendOpen(false);
                    setPacketOpen(true);
                  }}
                  className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 flex items-center justify-between"
                >
                  <span>Procurement Packet (CSV)</span>
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

      {/* ── Lifecycle summary card ── */}
      {result && result.lifecycleSummary.totalRows > 0 && (
        <LifecycleSummaryCard summary={result.lifecycleSummary} />
      )}

      {/* ── Design risk summary card ── */}
      {result && result.riskSummary.totalRows > 0 && (
        <RiskSummaryCard
          summary={result.riskSummary}
          rows={result.rows}
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
                      <RiskBadge row={row} />
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
                      <td className="px-3 py-2 border-b border-zinc-800/70" colSpan={16}>
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

      {drawerRow && drawerRow.partId && (
        <AlternatesDrawer
          sourcePartId={drawerRow.partId}
          sourceLabel={alternatesDrawerLabel(drawerRow)}
          onSwapPart={onSwapPart}
          onClose={() => setDrawerRow(null)}
        />
      )}

      {packetOpen && (
        <ProcurementModal
          busy={sending}
          onGenerate={generatePacket}
          onClose={() => setPacketOpen(false)}
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

// ─── Procurement packet modal ───────────────────────────────────────────────--

function ProcurementModal({
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
        <div className="text-sm font-medium text-zinc-100 mb-3">Generate procurement packet</div>

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
            {busy ? "Generating…" : "Generate"}
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

function RiskBadge({ row }: { row: BomRow }) {
  const risk = row.riskScore;
  const g = RISK_GRADE[risk.grade];

  const offers = row.pricing?.offers ?? [];
  const hasData = row.pricing !== null;
  const totalStock = offers.reduce((s, o) => s + (o.inStock ?? 0), 0);
  const suppliers = new Set(offers.filter((o) => (o.inStock ?? 0) > 0).map((o) => o.distributor)).size;
  const hasPrice = (row.pricing?.bestOverall?.bestUnitPrice ?? null) !== null;

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
            note={hasData ? `${totalStock.toLocaleString()} units` : "no data"}
          />
          <BreakdownLine
            label="Supplier mix"
            pts={risk.components.diversity}
            max={20}
            note={hasData ? `${suppliers} supplier${suppliers === 1 ? "" : "s"}` : "no data"}
          />
          <BreakdownLine
            label="Pricing"
            pts={risk.components.pricing}
            max={15}
            note={hasPrice ? "priced" : hasData ? "no price" : "no data"}
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

function RiskSummaryCard({
  summary,
  rows,
  onlyAtRisk,
  onToggleAtRisk,
}: {
  summary: DesignRiskSummary;
  rows: BomRow[];
  onlyAtRisk: boolean;
  onToggleAtRisk: () => void;
}) {
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
          <div className="text-[11px] text-zinc-400">{summary.recommendation}</div>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {summary.productionReady && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/15 text-green-300 border border-green-500/50 font-medium">
              Production-ready
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
                  {(() => {
                    const url = searchUrlFor(o);
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
