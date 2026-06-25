/**
 * Notification mapping (Stage 7).
 *
 * Turns a supply-chain `Change` (from snapshots.diffSnapshots) into a
 * persistable notification: a type, a severity, a human-readable summary
 * (≤200 chars), and structured before/after details.
 *
 * Notification types:
 *   "stock_dropped"       — stock fell ≥50%, or hit 0 across all sources
 *   "lifecycle_changed"   — lifecycle status worsened (active→nrnd, nrnd→eol, …)
 *   "price_spike"         — best price increased ≥25%
 *   "alternate_available" — a new drop_in alternate appeared
 *   "alternate_obsolete"  — a previously good alternate went EOL/obsolete (reserved; not yet diffed)
 *   "supplier_lost"       — the leading distributor's stock disappeared
 */

import type { Change } from "./snapshots";

export type NotificationType =
  | "stock_dropped"
  | "lifecycle_changed"
  | "price_spike"
  | "alternate_available"
  | "alternate_obsolete"
  | "supplier_lost";

export type NotificationSeverity = "info" | "warning" | "critical";

type NotificationDraft = {
  type: NotificationType;
  severity: NotificationSeverity;
  summary: string;
  details: Record<string, unknown>;
};

/** A readable part identifier for summaries: MPN, else "part". */
function partName(info: { mpn: string | null }): string {
  return info.mpn ?? "part";
}

function refDes(info: { refDesList: string[] }): string {
  return info.refDesList.join(", ");
}

function clamp(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatPrice(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(cents < 100 ? 4 : 2)} ${currency}`;
}

/** Map a Change to a notification draft (type, severity, summary, details). */
export function changeToNotification(
  change: Change,
  partInfo: { mpn: string | null; manufacturer: string | null; refDesList: string[] },
): NotificationDraft {
  const mpn = partName(partInfo);
  const refs = refDes(partInfo);

  switch (change.kind) {
    case "stock_dropped": {
      const isZero = change.after === 0;
      const summary = isZero
        ? `${mpn} (${refs}) is out of stock at all suppliers. Was ${change.before.toLocaleString()} units.`
        : `${mpn} stock dropped ${change.pct}% — from ${change.before.toLocaleString()} to ${change.after.toLocaleString()} units.`;
      return {
        type: "stock_dropped",
        severity: isZero ? "critical" : "warning",
        summary: clamp(summary),
        details: { before: change.before, after: change.after, pct: change.pct },
      };
    }
    case "lifecycle_changed": {
      const critical = change.after === "eol" || change.after === "obsolete";
      return {
        type: "lifecycle_changed",
        severity: critical ? "critical" : "warning",
        summary: clamp(
          `${mpn} lifecycle moved from ${change.before} to ${change.after}. Review before next build.`,
        ),
        details: { before: change.before, after: change.after },
      };
    }
    case "price_spike": {
      const before = formatPrice(change.beforeCents, change.currency);
      const after = formatPrice(change.afterCents, change.currency);
      return {
        type: "price_spike",
        severity: "warning",
        summary: clamp(`${mpn} best price increased ${change.pct}% — was ${before} → now ${after}.`),
        details: {
          beforeCents: change.beforeCents,
          afterCents: change.afterCents,
          pct: change.pct,
          currency: change.currency,
        },
      };
    }
    case "alternate_available": {
      const count = change.alternateCountAfter - change.alternateCountBefore;
      return {
        type: "alternate_available",
        severity: "info",
        summary: clamp(`${count} new alternate(s) available for ${mpn}.`),
        details: {
          alternateCountBefore: change.alternateCountBefore,
          alternateCountAfter: change.alternateCountAfter,
        },
      };
    }
    case "supplier_lost": {
      return {
        type: "supplier_lost",
        severity: "warning",
        summary: clamp(`A supplier no longer has stock for ${mpn} (${refs}).`),
        details: {},
      };
    }
  }
}
