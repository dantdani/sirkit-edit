/**
 * [B19-E E2] The contract of the bounded external candidate search: the request bounds, the answer the Build Library renders,
 * and the one authority label every hit carries.
 *
 * A hit is a SOURCING OBSERVATION: who said it (the source), whether the vendor answered this search or a recent one
 * (served from), when it was observed and when it expires (the registry's freshness), and whether its published MPN is
 * exactly the query. It never proves a part's identity, symbol, footprint or pinout, and it can never be placed.
 *
 * Browser-safe and pure: type-only imports, no server imports, no environment reads.
 */
import type { AcquisitionSourceId, AdmissionRefusal, CandidateSearchMode } from "./source-registry";
import type { OfferServedFrom } from "../distributors/types";

export const EXTERNAL_OBSERVATION_AUTHORITY = "sourcing observation — not engineering authority";

/** A query is at most this many printable ASCII characters after trimming. */
export const EXTERNAL_SEARCH_MAX_QUERY_LENGTH = 64;
/** At most this many candidates per source (OD-40). */
export const EXTERNAL_SEARCH_MAX_LIMIT = 5;

export type ExternalSearchMode = CandidateSearchMode;
export const EXTERNAL_SEARCH_MODES: readonly ExternalSearchMode[] = Object.freeze(["exact", "keyword"]);

export interface ExternalSearchRequest {
  query: string;
  mode: ExternalSearchMode;
  /** Registry sources to ask; default every registered source (a blocked or disabled one answers with its refusal). */
  sources?: readonly AcquisitionSourceId[];
  limit: number;
}

export type ExternalSearchRefusalCode =
  | "EXTERNAL_SEARCH_QUERY_INVALID"
  | "EXTERNAL_SEARCH_MODE_INVALID"
  | "EXTERNAL_SEARCH_LIMIT_INVALID"
  | "EXTERNAL_SEARCH_SOURCES_INVALID"
  | "EXTERNAL_SEARCH_MODE_NOT_PERMITTED";

export interface ExternalCandidateHit {
  sourceId: AcquisitionSourceId;
  sourceDisplayName: string;
  attribution: string;
  /** [B19-E E2 review] The followable link the source's terms require beside its data (registry), shown with every hit; or null. */
  attributionLink: string | null;
  /** The MPN as the vendor published it — never the query put in its place. */
  mpn: string;
  exactMatch: boolean;
  manufacturer: string | null;
  description: string | null;
  packaging: string | null;
  lifecycle: string;
  stock: number | null;
  minimumOrderQuantity: number | null;
  priceBreaks: Array<{ quantity: number; unitPrice: number; currency: string }>;
  /** A vendor product page over https, or null. */
  productUrl: string | null;
  /** A datasheet over https, or null. */
  datasheetUrl: string | null;
  servedFrom: Extract<OfferServedFrom, "live" | "process-memo">;
  observedAt: number;
  expiresAt: number;
  authority: typeof EXTERNAL_OBSERVATION_AUTHORITY;
  observationId: string;
  candidateId: string;
}

export interface ExternalSearchSourceStatus {
  sourceId: AcquisitionSourceId;
  displayName: string;
  /** available (asked, answered from memory, or not asked without live search), paused, failed, not_searchable, or the admission refusal. */
  status: "available" | "paused" | "failed" | "not_searchable" | AdmissionRefusal;
  ownerDecision: string | null;
  /** When a paused source may be tried again (unix ms); null otherwise. */
  retryAt: number | null;
  freshnessLabel: string;
  attribution: string;
  /** [B19-E E2 review] The followable link the source's terms require beside its data (registry), or null. */
  attributionLink: string | null;
  /** Where this source's hits came from; null when nothing was asked or served. */
  servedFrom: Extract<OfferServedFrom, "live" | "process-memo"> | null;
  hitCount: number;
  /** Hits not shown: a confusable or over-long MPN. */
  withheldHits: number;
}

export type ExternalSearchResult =
  | {
    ok: true;
    query: string;
    mode: ExternalSearchMode;
    limit: number;
    live: boolean;
    registryVersion: string;
    authority: typeof EXTERNAL_OBSERVATION_AUTHORITY;
    sources: ExternalSearchSourceStatus[];
    hits: ExternalCandidateHit[];
    generatedAt: number;
  }
  | { ok: false; code: ExternalSearchRefusalCode; error: string };
