/**
 * [B19-E E1] How a pricing source and an offer are labelled wherever a person sees them: the BOM workbench, its exports and
 * the offer details.
 *
 * Every word comes from the source registry — who the source is, whether it is enabled and under which owner decision, its
 * attribution, and how long an observation may be served. An offer's freshness is measured from when the vendor answered
 * (`provenance.retrievedAt`), never from when it was re-served or re-stored; a source whose terms prohibit storage (Mouser,
 * LCSC) never gets a servable label. The words "fresh" and "stale" are the sourcing vocabulary of
 * `component-selection/sourcing.ts`.
 *
 * Browser-safe and pure: no server imports, no environment reads.
 */
import { SOURCE_REGISTRY, sourceForDistributorName, type AcquisitionSourceId, type SourceRegistryEntry, type SourceStatus } from "./source-registry";
import type { OfferServedFrom, PartPricing } from "../distributors/types";

export interface SourceLabel {
  sourceId: AcquisitionSourceId;
  displayName: string;
  registryStatus: SourceStatus;
  ownerDecision: string | null;
  attribution: string;
  freshnessLabel: string;
  /** How long an observation may be served after the vendor answered; 0 = never served from any cache. */
  servedForMs: number;
}

function entryFor(idOrDistributorName: string): SourceRegistryEntry | null {
  if (Object.prototype.hasOwnProperty.call(SOURCE_REGISTRY, idOrDistributorName)) return SOURCE_REGISTRY[idOrDistributorName as AcquisitionSourceId];
  return sourceForDistributorName(idOrDistributorName);
}

export function sourceLabel(idOrDistributorName: string): SourceLabel | null {
  const entry = entryFor(idOrDistributorName);
  if (!entry) return null;
  return {
    sourceId: entry.id,
    displayName: entry.displayName,
    registryStatus: entry.state.status,
    ownerDecision: entry.state.ownerDecision,
    attribution: entry.license.attribution,
    freshnessLabel: entry.freshness.label,
    servedForMs: entry.freshness.offerTtlMs,
  };
}

export interface OfferFreshness {
  sourceId: AcquisitionSourceId;
  displayName: string;
  servedFrom: OfferServedFrom;
  /** "live": a vendor answer made for this lookup; "cached": the offer cache or a connector's memo. */
  basis: "live" | "cached";
  retrievedAt: number;
  expiresAt: number;
  state: "fresh" | "stale";
  /** May this observation still be served? Never true for a no-storage source. */
  servable: boolean;
  label: string;
}

/** A UTC timestamp to the minute, e.g. "2026-09-13 12:00 UTC". */
export function utcMinute(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** [B19-E E2] exported: the Build Library's external search labels its hits with the same words */
export const SERVED_FROM_WORDS: Readonly<Record<OfferServedFrom, string>> = {
  live: "live",
  "process-memo": "cached (recent answer)",
  "offer-cache": "cached",
};

export function offerFreshness(offer: Pick<PartPricing, "distributor" | "fetchedAt" | "provenance" | "evidence"> | { distributor: string; fetchedAt: number; provenance?: PartPricing["provenance"]; evidence?: PartPricing["evidence"] }, now: number = Date.now()): OfferFreshness | null {
  const entry = sourceForDistributorName(offer.distributor);
  if (!entry) return null;
  const servedFrom: OfferServedFrom = offer.provenance?.servedFrom ?? (offer.evidence ? "live" : "offer-cache");
  const recorded = offer.provenance?.retrievedAt ?? offer.evidence?.retrievedAt ?? offer.fetchedAt;
  const retrievedAt = Number.isFinite(recorded) ? Math.min(recorded, now) : now;
  const servedForMs = entry.freshness.offerTtlMs;
  const expiresAt = retrievedAt + servedForMs;
  const servable = servedForMs > 0 && now < expiresAt;
  const basis = servedFrom === "live" ? "live" : "cached";
  const label = servedForMs > 0
    ? `${entry.displayName} · ${SERVED_FROM_WORDS[servedFrom]} · observed ${utcMinute(retrievedAt)} · ${servable ? "expires" : "expired"} ${utcMinute(expiresAt)}`
    : `${entry.displayName} · ${SERVED_FROM_WORDS[servedFrom]} · observed ${utcMinute(retrievedAt)} · not kept (its terms prohibit storing it)`;
  return { sourceId: entry.id, displayName: entry.displayName, servedFrom, basis, retrievedAt, expiresAt, state: servable ? "fresh" : "stale", servable, label };
}
