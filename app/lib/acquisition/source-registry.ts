/**
 * [B19-A] The versioned registry of external acquisition sources.
 *
 * One reviewed record per source says who the source is, which exact hosts and operations Sirkit may call, how it
 * authenticates (by secret REFERENCE — an environment variable name — never a value), what it may be used to observe,
 * its quota, its time/size/retry/breaker budget, how long its data may be served and kept, what its terms allow, its
 * regional scope, what authority its data can carry, and whether it is enabled, disabled or blocked.
 *
 * It is not documentation beside the code: the connectors read their policy from here.
 *  - the egress boundary takes each source's hosts, deadline, body ceiling and secret query parameters from it;
 *  - a source is only constructed when `admitSource` admits it: a BLOCKED source never, a DISABLED one only by a reviewed
 *    change to this file, and an operator may switch any source OFF (never on) with `SIRKIT_ACQUISITION_DISABLED_SOURCES`;
 *  - request spacing, offer freshness, storage and retention, and whether a bulk refresh is permitted all come from here.
 *
 * Every fact below was checked against the vendor's OWN current documentation on `documentationCheckedOn`; the URLs are
 * recorded per source. A fact the official documentation does not state is recorded as UNKNOWN, and where the terms are
 * unclear the registry takes the restrictive reading and records an owner decision rather than guessing.
 *
 * Browser-safe: no environment reads at module load, no server imports. Bump `SOURCE_REGISTRY_VERSION` on any change;
 * the rendered artifact (`artifacts/ai-control-plane-b19/source-registry.csv`) is gated byte-for-byte.
 */
import type { LicenseDisposition, SourceClass } from "../atomic/types";

export const SOURCE_REGISTRY_VERSION = "1.1.0"; // [B19-E E2] candidate search + agentDisclosure

export type AcquisitionSourceId = "digikey" | "mouser" | "octopart" | "lcsc";

/** The offer-cache key each source's observations are stored under (the pre-B19 `part_offers.distributor` values). */
export type AcquisitionDistributorName = "digikey" | "mouser" | "octopart-aggregated" | "lcsc";

export type ObservationKind =
  | "unit-price-breaks"
  | "stock-quantity"
  | "minimum-order-quantity"
  | "lifecycle-claim"
  | "manufacturer-name"
  | "description"
  | "datasheet-link"
  | "product-page-link"
  | "distributor-sku"
  | "packaging-claim";

/**
 * What a source's data may be used to establish. A distributor or aggregator observation may support SOURCING
 * (availability, price, a lifecycle claim) and can never alone establish engineering facts.
 */
export type AcquisitionAuthorityClass = "sourcing_observation";

export const ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING = Object.freeze([
  "exact-part-identity",
  "electrical-pin-mapping",
  "symbol",
  "footprint",
  "package-geometry",
  "cad-correctness",
] as const);

export type SourceStatus = "enabled" | "disabled" | "blocked";

export type AuthMethod = "oauth2-client-credentials" | "api-key-query-parameter" | "bearer-access-token" | "signed-request-partner-key";

export interface SecretReference {
  /** Environment variable NAME. Never a value. */
  env: string;
  /** Older names still read, in order, when `env` is unset. */
  fallbacks: readonly string[];
  role: string;
  /** Where the connector places it on the wire. */
  placement: "form-body" | "header" | "query-parameter" | "authorization-bearer";
}

export interface QuotaLimit {
  window: "minute" | "day" | "month";
  max: number;
  unit: "request" | "matched-part";
}

export type Basis = "documented" | "conservative-default" | "unknown";

/** [B19-E E2] How a search names a part: by its exact published MPN, or by keywords. */
export type CandidateSearchMode = "exact" | "keyword";

/** [B19-E E2] The most candidates one search may return per source (OD-40). */
export const CANDIDATE_SEARCH_MAX_RESULTS = 5;

/**
 * [B19-E E2] A source's bounded candidate search: the registered operation it calls, the modes it serves, its result ceiling,
 * what one search costs against the quota (one request, or every matched part the query can return), and what a hit may be
 * used to observe. Null: the source is never searched.
 */
export interface CandidateSearchPolicy {
  operationUrl: string;
  modes: readonly CandidateSearchMode[];
  maxResults: number;
  cost: "request" | "matched-parts-at-limit";
  observations: readonly ObservationKind[];
}

/** [B19-E E2] May this source's observations be disclosed to an agent (and so to the LLM provider)? OD-36. */
export type AgentDisclosure = "permitted" | "prohibited" | "unknown";

export interface SourceRegistryEntry {
  id: AcquisitionSourceId;
  distributorName: AcquisitionDistributorName;
  displayName: string;
  provider: {
    organization: string;
    api: string;
    apiVersion: string;
    /** Official pages read to establish this record. */
    documentation: readonly string[];
    documentationCheckedOn: string;
    notes: readonly string[];
  };
  endpoints: {
    /** Exact hosts the egress boundary admits for this source. No wildcards. */
    hosts: readonly string[];
    operations: readonly { purpose: string; method: "GET" | "POST"; url: string }[];
    /** Hosts the vendor documents that Sirkit deliberately does NOT call (sandbox, token services not in use). */
    notCalled: readonly string[];
  };
  auth: {
    method: AuthMethod;
    secrets: readonly SecretReference[];
    /** Query parameters that carry a secret (vendor-mandated); never logged, never redirected. */
    secretQueryParams: readonly string[];
    tokenLifetime: string;
  };
  observations: readonly ObservationKind[];
  candidateSearch: CandidateSearchPolicy | null;
  quota: {
    limits: readonly QuotaLimit[];
    basis: Basis;
    perRequest: string;
    notes: readonly string[];
  };
  resilience: {
    deadlineMs: number;
    maxResponseBytes: number;
    maxRedirects: 0;
    /** Minimum spacing between requests, derived from the tightest per-minute limit. */
    minRequestSpacingMs: number;
    retry: { automaticRetries: number; onRateLimit: string };
    breaker: { consecutiveFailuresToOpen: number; openMs: number };
  };
  freshness: {
    /** How long an observation may be SERVED after it was fetched. 0 = never served from any cache. */
    offerTtlMs: number;
    label: string;
    sourceSideStaleness: string;
  };
  license: {
    terms: readonly string[];
    termsDated: string;
    /** "no-storage": never persisted, never memoized across requests. "bounded": kept at most `retentionMaxMs`. */
    storage: "no-storage" | "bounded";
    retentionMaxMs: number;
    retentionBasis: Basis;
    /** May an operator job pre-fetch or refresh observations in bulk? Anything but "permitted" is refused. */
    bulkRefresh: "permitted" | "prohibited" | "unknown";
    rawRedistribution: LicenseDisposition;
    derivedRedistribution: LicenseDisposition;
    exportDisposition: LicenseDisposition;
    /** [B19-E E2] OD-36: "unknown" until a reviewed revision decides; never "permitted" for a blocked or disabled source. */
    agentDisclosure: AgentDisclosure;
    repositoryCommit: "prohibited";
    attribution: string;
    /** [B19-E E2 review] The followable https link the terms require beside the source's data (Nexar: octopart.com); null when none. */
    attributionLink: string | null;
    restrictions: readonly string[];
  };
  scope: { region: string; currency: string; locale: string; account: string };
  sourceClass: SourceClass;
  authorityClass: AcquisitionAuthorityClass;
  state: { status: SourceStatus; reason: string; ownerDecision: string | null };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CHECKED_ON = "2026-09-13";

const ENTRIES: readonly SourceRegistryEntry[] = [
  {
    id: "digikey",
    distributorName: "digikey",
    displayName: "DigiKey",
    provider: {
      organization: "Digi-Key Electronics",
      api: "Product Information API",
      apiVersion: "V4 (current; the connector's keyword search is in the V4 OpenAPI specification)",
      documentation: [
        "https://developer.digikey.com/documentation",
        "https://developer.digikey.com/faq/products-plans-and-apis",
        "https://developer.digikey.com/node/2357/oas-download",
        "https://developer.digikey.com/changelog",
      ],
      documentationCheckedOn: CHECKED_ON,
      notes: [
        "Since 2025-11-24 the account header is X-DIGIKEY-Account-ID (X-DIGIKEY-Customer-Id was removed); the connector sends neither and uses the default account.",
        "Since 4.0.3 KeywordSearch no longer fills MyPricing; ProductDetails is the real-time endpoint (not called).",
        "[B19-E E2] The candidate search reuses the keyword search (Limit at most 5). Its keyword-search terms were not re-read for E2 (no network in the implementing session), so documentationCheckedOn keeps the earlier check.",
      ],
    },
    endpoints: {
      hosts: ["api.digikey.com"],
      operations: [
        { purpose: "OAuth2 client-credentials token", method: "POST", url: "https://api.digikey.com/v1/oauth2/token" },
        { purpose: "keyword search by MPN", method: "POST", url: "https://api.digikey.com/products/v4/search/keyword" },
        { purpose: "candidate search by exact MPN or keyword (Limit at most 5)", method: "POST", url: "https://api.digikey.com/products/v4/search/keyword" },
      ],
      notCalled: ["sandbox-api.digikey.com (sandbox apps may call only the sandbox)"],
    },
    auth: {
      method: "oauth2-client-credentials",
      secrets: [
        { env: "DIGIKEY_CLIENT_ID", fallbacks: [], role: "OAuth client id (also the X-DIGIKEY-Client-Id header)", placement: "form-body" },
        { env: "DIGIKEY_CLIENT_SECRET", fallbacks: [], role: "OAuth client secret", placement: "form-body" },
      ],
      secretQueryParams: [],
      tokenLifetime: "10 minutes (2-legged); cached in memory and refreshed early or on a 401",
    },
    observations: ["unit-price-breaks", "stock-quantity", "minimum-order-quantity", "lifecycle-claim", "manufacturer-name", "description", "datasheet-link", "product-page-link", "packaging-claim"],
    candidateSearch: {
      operationUrl: "https://api.digikey.com/products/v4/search/keyword",
      modes: ["exact", "keyword"],
      maxResults: CANDIDATE_SEARCH_MAX_RESULTS,
      cost: "request",
      observations: ["manufacturer-name", "description", "datasheet-link", "product-page-link", "stock-quantity", "unit-price-breaks", "minimum-order-quantity", "lifecycle-claim", "packaging-claim"],
    },
    quota: {
      limits: [
        { window: "minute", max: 120, unit: "request" },
        { window: "day", max: 1000, unit: "request" },
      ],
      basis: "documented",
      perRequest: "one MPN per keyword search (Limit 5 results)",
      notes: [
        "Counted per product (Product Information).",
        "A 429 names BurstLimit or Daily Ratelimit and carries X-RateLimit-*, X-BurstLimit-* and Retry-After.",
        "The API user agreement suspends an account for 10 minutes when a per-second threshold is exceeded.",
      ],
    },
    resilience: {
      deadlineMs: 15_000,
      maxResponseBytes: 2_000_000,
      maxRedirects: 0,
      minRequestSpacingMs: MINUTE / 120,
      retry: { automaticRetries: 0, onRateLimit: "no automatic retry: a 429 degrades to a missing price; one token refresh on a 401" },
      breaker: { consecutiveFailuresToOpen: 5, openMs: 10 * MINUTE },
    },
    freshness: {
      offerTtlMs: HOUR,
      label: "DigiKey keyword search",
      sourceSideStaleness: "DigiKey documents KeywordSearch data as cached and up to 24 hours old at the source",
    },
    license: {
      terms: ["https://developer.digikey.com/api-user-agreement"],
      termsDated: "undated at the time of reading",
      storage: "bounded",
      retentionMaxMs: HOUR,
      retentionBasis: "conservative-default",
      bulkRefresh: "prohibited",
      rawRedistribution: "prohibited",
      derivedRedistribution: "prohibited",
      exportDisposition: "private_review_only",
      agentDisclosure: "unknown", // [B19-E E2] OD-36
      repositoryCommit: "prohibited",
      attribution: "Credit DigiKey clearly as the source of its data",
      attributionLink: null,
      restrictions: [
        "No building or updating a database from DigiKey data; no bulk download.",
        "No providing the data to third parties beyond the approved display.",
        "Keep DigiKey data clearly distinguished when shown with other content; no competitive use.",
        "Delete all data on termination.",
      ],
    },
    scope: { region: "US site (X-DIGIKEY-Locale-Site default)", currency: "USD (site default)", locale: "en", account: "the operator's DigiKey API application" },
    sourceClass: "distributor_catalog",
    authorityClass: "sourcing_observation",
    state: { status: "enabled", reason: "Official V4 API with the operator's own credentials; used within its documented limits.", ownerDecision: "OD-33" },
  },
  {
    id: "mouser",
    distributorName: "mouser",
    displayName: "Mouser",
    provider: {
      organization: "Mouser Electronics",
      api: "Search API",
      apiVersion: "V1 part-number search (not deprecated; V2 has no plain part-number endpoint)",
      documentation: ["https://www.mouser.com/en/api-search/", "https://api.mouser.com/api/docs/V1", "https://api.mouser.com/api/docs/V2"],
      documentationCheckedOn: CHECKED_ON,
      notes: ["An API key is issued after Mouser reviews a request form."],
    },
    endpoints: {
      hosts: ["api.mouser.com"],
      operations: [{ purpose: "part-number search", method: "POST", url: "https://api.mouser.com/api/v1/search/partnumber" }],
      notCalled: [],
    },
    auth: {
      method: "api-key-query-parameter",
      secrets: [{ env: "MOUSER_API_KEY", fallbacks: [], role: "Search API key", placement: "query-parameter" }],
      secretQueryParams: ["apiKey"],
      tokenLifetime: "not applicable (static key)",
    },
    observations: ["unit-price-breaks", "stock-quantity", "minimum-order-quantity", "lifecycle-claim", "manufacturer-name", "description", "datasheet-link", "product-page-link", "distributor-sku"],
    candidateSearch: null,
    quota: {
      limits: [
        { window: "minute", max: 30, unit: "request" },
        { window: "day", max: 1000, unit: "request" },
      ],
      basis: "documented",
      perRequest: "up to 10 part numbers per request (pipe-separated), up to 50 results per call; the connector sends one",
      notes: ["429 behaviour and rate-limit headers are UNKNOWN (the specification defines only a 200 response)."],
    },
    resilience: {
      deadlineMs: 15_000,
      maxResponseBytes: 2_000_000,
      maxRedirects: 0,
      minRequestSpacingMs: MINUTE / 30,
      retry: { automaticRetries: 0, onRateLimit: "no automatic retry: a failure degrades to a missing price" },
      breaker: { consecutiveFailuresToOpen: 5, openMs: 10 * MINUTE },
    },
    freshness: {
      offerTtlMs: 0,
      label: "Mouser part-number search (live only)",
      sourceSideStaleness: "UNKNOWN",
    },
    license: {
      terms: ["https://www.mouser.com/en/apiterms/"],
      termsDated: "last modified 2013-03-11",
      storage: "no-storage",
      retentionMaxMs: 0,
      retentionBasis: "documented",
      bulkRefresh: "prohibited",
      rawRedistribution: "prohibited",
      derivedRedistribution: "prohibited",
      exportDisposition: "private_review_only",
      agentDisclosure: "unknown", // [B19-E E2] OD-36
      repositoryCommit: "prohibited",
      attribution: "Credit Mouser clearly as the source and keep its links intact",
      attributionLink: null,
      restrictions: [
        "No caching, recording, pre-fetching or storing Mouser content; no bulk download; no database built from it.",
        "Display is licensed only inside the application; keep Mouser data distinguished from third-party content.",
        "The application's primary purpose must be to drive sales to Mouser; keys are not transferable.",
      ],
    },
    scope: { region: "UNKNOWN (no locale parameter on the search endpoints)", currency: "UNKNOWN", locale: "UNKNOWN", account: "the operator's Mouser API key" },
    sourceClass: "distributor_catalog",
    authorityClass: "sourcing_observation",
    state: {
      status: "disabled",
      reason: "Mouser's API terms prohibit caching or storing its content and require the application's primary purpose to be driving Mouser sales; a multi-distributor BOM comparison does not meet that on its face. Disabled until the owner confirms compliance.",
      ownerDecision: "OD-32",
    },
  },
  {
    id: "octopart",
    distributorName: "octopart-aggregated",
    displayName: "Octopart (Nexar)",
    provider: {
      organization: "Nexar",
      api: "Supply GraphQL API (Octopart data)",
      apiVersion: "Nexar GraphQL (current; the legacy Octopart v4 API has a published migration guide)",
      documentation: [
        "https://support.nexar.com/support/solutions/articles/101000471994-authorization",
        "https://support.nexar.com/support/solutions/articles/101000452406-application-access-token",
        "https://support.nexar.com/support/solutions/articles/101000476314-part-limits-and-how-they-work",
        "https://support.nexar.com/support/solutions/articles/101000497890-frequently-asked-questions",
        "https://nexar.com/compare-plans",
      ],
      documentationCheckedOn: CHECKED_ON,
      notes: [
        "Nexar issues access tokens by OAuth2 client credentials (scope supply.domain) at identity.nexar.com, valid 24 hours. The connector does NOT run that flow: it sends a pre-issued access token from the environment, which expires. Recorded as a connector gap.",
        "Nexar times a request out after 90 seconds and answers an exceeded part limit with an error.",
        "[B19-E E2] The candidate search is one supSearchMpn (exact) or supSearch (keyword) query with limit at most 5; every part it can return is reserved. Its terms were not re-read for E2 (no network in the implementing session), so documentationCheckedOn keeps the earlier check.",
      ],
    },
    endpoints: {
      hosts: ["api.nexar.com"],
      operations: [
        { purpose: "supSearchMpn GraphQL query (limit 1 per MPN, aliased batches)", method: "POST", url: "https://api.nexar.com/graphql" },
        { purpose: "candidate search: supSearchMpn (exact) or supSearch (keyword) GraphQL query (limit at most 5)", method: "POST", url: "https://api.nexar.com/graphql" },
      ],
      notCalled: ["identity.nexar.com (token service; the connector uses a pre-issued token)"],
    },
    auth: {
      method: "bearer-access-token",
      secrets: [{ env: "OCTOPART_API_KEY", fallbacks: ["NEXAR_API_KEY"], role: "Nexar access token", placement: "authorization-bearer" }],
      secretQueryParams: [],
      tokenLifetime: "24 hours (Nexar); a pre-issued token in the environment expires",
    },
    observations: ["unit-price-breaks", "stock-quantity", "lifecycle-claim", "manufacturer-name", "description", "datasheet-link", "product-page-link"],
    candidateSearch: {
      operationUrl: "https://api.nexar.com/graphql",
      modes: ["exact", "keyword"],
      maxResults: CANDIDATE_SEARCH_MAX_RESULTS,
      cost: "matched-parts-at-limit",
      observations: ["manufacturer-name", "description", "datasheet-link", "product-page-link", "stock-quantity", "unit-price-breaks", "lifecycle-claim"],
    },
    quota: {
      limits: [{ window: "month", max: 2000, unit: "matched-part" }],
      basis: "documented",
      perRequest: "every part returned by a sup* query counts; the connector asks for 1 per MPN",
      notes: [
        "Plan-dependent: Standard up to 2,000 matched parts a month, Pro up to 15,000, Enterprise custom; resets on the 1st, no rollover. The registry records the Standard plan.",
        "The Evaluation limit is inconsistent across Nexar's own pages (100, one-time 100, lifetime 1,000, 1,000 a month): UNKNOWN.",
        "Request-rate limits and 429 behaviour for the GraphQL API: UNKNOWN. Token requests are limited (2 a second, 200 per 15 minutes).",
      ],
    },
    resilience: {
      deadlineMs: 20_000,
      maxResponseBytes: 4_000_000,
      maxRedirects: 0,
      minRequestSpacingMs: 0,
      retry: { automaticRetries: 0, onRateLimit: "no automatic retry: a failure degrades to missing prices" },
      breaker: { consecutiveFailuresToOpen: 5, openMs: 10 * MINUTE },
    },
    freshness: {
      offerTtlMs: DAY,
      label: "Octopart via Nexar",
      sourceSideStaleness: "UNKNOWN",
    },
    license: {
      terms: ["https://nexar.com/api/legal"],
      termsDated: "last updated 2022-08-01",
      storage: "bounded",
      retentionMaxMs: DAY,
      retentionBasis: "documented",
      bulkRefresh: "unknown",
      rawRedistribution: "prohibited",
      derivedRedistribution: "prohibited",
      exportDisposition: "private_review_only",
      agentDisclosure: "unknown", // [B19-E E2] OD-36
      repositoryCommit: "prohibited",
      attribution: "Include a followable link to octopart.com or the part page; credit the domain of any image",
      attributionLink: "https://octopart.com/", // [B19-E E2 review] shown with every hit: a hit may carry no part-page link
      restrictions: [
        "No caching or storing data for more than 24 hours.",
        "No self-hosting datasheets or images; no sublicensing or distributing the API; no benchmarking or competing products.",
        "No mass aggregation for predictive analytics; distributors limit use of their pricing and availability.",
      ],
    },
    scope: { region: "UNKNOWN", currency: "per offer (USD assumed when absent)", locale: "UNKNOWN", account: "the operator's Nexar application" },
    sourceClass: "distributor_catalog",
    authorityClass: "sourcing_observation",
    state: { status: "enabled", reason: "Official Nexar API with the operator's own token; stored at most 24 hours as its terms require.", ownerDecision: "OD-33" },
  },
  {
    id: "lcsc",
    distributorName: "lcsc",
    displayName: "LCSC",
    provider: {
      organization: "LCSC Electronics",
      api: "LCSC Open API",
      apiVersion: "unversioned",
      documentation: [
        "https://www.lcsc.com/docs/openapi/index.html",
        "https://www.lcsc.com/docs/index.html",
        "https://www.lcsc.com/help-center/api/get-lcsc-apis",
        "https://www.lcsc.com/help-center/api/api-access-frequency",
      ],
      documentationCheckedOn: CHECKED_ON,
      notes: [
        "An official API exists; access needs an LCSC account and an approved application with company documents.",
        "JLCPCB also offers an approval-gated API (api.jlcpcb.com); it is not a registered source.",
      ],
    },
    endpoints: {
      hosts: [],
      operations: [],
      notCalled: ["ips.lcsc.com (the official API host; no approved access)"],
    },
    auth: {
      method: "signed-request-partner-key",
      secrets: [],
      secretQueryParams: [],
      tokenLifetime: "not applicable (key, nonce, timestamp and signature per request; signing details UNKNOWN)",
    },
    observations: [],
    candidateSearch: null,
    quota: {
      limits: [
        { window: "minute", max: 200, unit: "request" },
        { window: "day", max: 1000, unit: "request" },
      ],
      basis: "documented",
      perRequest: "search returns 30 per page",
      notes: ["Higher limits on request; 429 behaviour UNKNOWN."],
    },
    resilience: {
      deadlineMs: 15_000,
      maxResponseBytes: 2_000_000,
      maxRedirects: 0,
      minRequestSpacingMs: MINUTE / 200,
      retry: { automaticRetries: 0, onRateLimit: "not applicable (blocked)" },
      breaker: { consecutiveFailuresToOpen: 5, openMs: 10 * MINUTE },
    },
    freshness: { offerTtlMs: 0, label: "LCSC (blocked)", sourceSideStaleness: "documented as real-time" },
    license: {
      terms: ["https://www.lcsc.com/docs/index.html"],
      termsDated: "undated at the time of reading",
      storage: "no-storage",
      retentionMaxMs: 0,
      retentionBasis: "unknown",
      bulkRefresh: "prohibited",
      rawRedistribution: "prohibited",
      derivedRedistribution: "prohibited",
      exportDisposition: "prohibited",
      agentDisclosure: "unknown", // [B19-E E2] OD-36
      repositoryCommit: "prohibited",
      attribution: "Credit LCSC as the source",
      attributionLink: null,
      restrictions: [
        "No bulk data capture; no hosting or providing retrieved material (datasheets, images) to third parties.",
        "No selling the data or derivatives, or feeding it to public or commercial APIs; credentials stay inside the company.",
      ],
    },
    scope: { region: "UNKNOWN", currency: "USD, CNY, EUR or HKD (documented)", locale: "UNKNOWN", account: "none" },
    sourceClass: "distributor_catalog",
    authorityClass: "sourcing_observation",
    state: {
      status: "blocked",
      reason: "LCSC's official API requires an approved partner application; Sirkit has no such access. Blocked by the runbook until legitimate access exists; no scraping and no unofficial access.",
      ownerDecision: null,
    },
  },
];

export const SOURCE_REGISTRY: Readonly<Record<AcquisitionSourceId, SourceRegistryEntry>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.id, deepFreeze(entry)])) as Record<AcquisitionSourceId, SourceRegistryEntry>,
);

export const SOURCE_IDS: readonly AcquisitionSourceId[] = Object.freeze(ENTRIES.map((entry) => entry.id));

export function sourceEntry(id: AcquisitionSourceId): SourceRegistryEntry {
  return SOURCE_REGISTRY[id];
}

export function sourceForDistributorName(name: string): SourceRegistryEntry | null {
  return ENTRIES.find((entry) => entry.distributorName === name) ?? null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

// ── Admission ────────────────────────────────────────────────────────────────

export const OPERATOR_DISABLE_ENV = "SIRKIT_ACQUISITION_DISABLED_SOURCES";

export type AdmissionRefusal = "blocked" | "disabled" | "operator_disabled" | "credentials_missing";

export type SourceAdmission =
  | { admitted: true; id: AcquisitionSourceId; secrets: Readonly<Record<string, string>> }
  | { admitted: false; id: AcquisitionSourceId; refusal: AdmissionRefusal; message: string };

/**
 * Decide whether a source may be constructed now. Secrets are read BY REFERENCE from `env` and returned only to the
 * caller that constructs the connector; the refusal message names environment variables, never values.
 */
export function admitSource(id: AcquisitionSourceId, env: Readonly<Record<string, string | undefined>>): SourceAdmission {
  const entry = SOURCE_REGISTRY[id];
  if (entry.state.status === "blocked") return { admitted: false, id, refusal: "blocked", message: `${entry.displayName} is blocked: ${entry.state.reason}` };
  if (entry.state.status === "disabled") {
    return { admitted: false, id, refusal: "disabled", message: `${entry.displayName} pricing is disabled: ${entry.state.reason}${entry.state.ownerDecision ? ` (${entry.state.ownerDecision})` : ""}` };
  }
  const operatorDisabled = (env[OPERATOR_DISABLE_ENV] ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (operatorDisabled.includes(id)) return { admitted: false, id, refusal: "operator_disabled", message: `${entry.displayName} is switched off by the operator (${OPERATOR_DISABLE_ENV}).` };
  const secrets: Record<string, string> = {};
  const missing: string[] = [];
  for (const reference of entry.auth.secrets) {
    const value = [reference.env, ...reference.fallbacks].map((name) => env[name]).find((candidate) => typeof candidate === "string" && candidate.trim() !== "");
    if (value === undefined) missing.push([reference.env, ...reference.fallbacks].join(" or "));
    else secrets[reference.env] = value;
  }
  if (missing.length > 0) {
    return { admitted: false, id, refusal: "credentials_missing", message: `${entry.displayName} API credentials not configured — set ${missing.join(" and ")} in the server environment.` };
  }
  return { admitted: true, id, secrets: Object.freeze(secrets) };
}

// ── Validation ───────────────────────────────────────────────────────────────

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const SECRET_SHAPES = /sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|hf_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** [B19-E E2 review] a plain https link: a host and a path, no credentials, query or fragment */
const ATTRIBUTION_LINK = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\/[A-Za-z0-9._~/-]*$/;
const AGENT_DISCLOSURES: readonly AgentDisclosure[] = ["permitted", "prohibited", "unknown"];
const CANDIDATE_SEARCH_MODES: readonly CandidateSearchMode[] = ["exact", "keyword"];

/** Every structural rule a registry revision must satisfy. Returns human-readable violations; empty means valid. */
export function validateSourceRegistry(entries: readonly SourceRegistryEntry[] = ENTRIES): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const at = (message: string) => errors.push(`${entry.id}: ${message}`);
    if (ids.has(entry.id)) at("duplicate id");
    ids.add(entry.id);
    for (const [field, value] of Object.entries({ displayName: entry.displayName, organization: entry.provider.organization, api: entry.provider.api, apiVersion: entry.provider.apiVersion, attribution: entry.license.attribution, reason: entry.state.reason, label: entry.freshness.label })) {
      if (!value || value.trim() === "") at(`${field} is empty`);
    }
    if (entry.provider.documentation.length === 0) at("no official documentation recorded");
    if (!DATE.test(entry.provider.documentationCheckedOn)) at("documentationCheckedOn is not a date");
    for (const url of [...entry.provider.documentation, ...entry.license.terms]) {
      if (!url.startsWith("https://")) at(`documentation is not HTTPS: ${url}`);
    }
    if (entry.license.terms.length === 0) at("no terms recorded");
    for (const host of entry.endpoints.hosts) {
      if (!HOST.test(host)) at(`host is not an exact lowercase hostname: ${host}`);
    }
    for (const operation of entry.endpoints.operations) {
      let url: URL | null = null;
      try { url = new URL(operation.url); } catch { at(`operation URL is invalid: ${operation.url}`); }
      if (!url) continue;
      if (url.protocol !== "https:") at(`operation is not HTTPS: ${operation.url}`);
      if (!entry.endpoints.hosts.includes(url.hostname)) at(`operation host ${url.hostname} is not in hosts`);
      if (url.username || url.password || url.search) at(`operation URL carries credentials or a query: ${operation.url}`);
    }
    if (entry.state.status === "enabled" && entry.endpoints.operations.length === 0) at("an enabled source has no operations");
    if (entry.state.status === "blocked" && (entry.endpoints.hosts.length > 0 || entry.auth.secrets.length > 0)) at("a blocked source may not declare callable hosts or secrets");
    if (entry.state.status !== "enabled" && !entry.state.reason.trim()) at("a disabled or blocked source needs a reason");
    for (const reference of entry.auth.secrets) {
      for (const name of [reference.env, ...reference.fallbacks]) {
        if (!ENV_NAME.test(name)) at(`secret reference is not an environment variable name: ${name}`);
      }
    }
    if (entry.auth.method === "api-key-query-parameter" && entry.auth.secretQueryParams.length === 0) at("a query-parameter key must be declared in secretQueryParams");
    if (entry.quota.limits.length === 0) at("no quota recorded");
    for (const limit of entry.quota.limits) {
      if (!Number.isInteger(limit.max) || limit.max <= 0) at(`quota ${limit.window} is not a positive integer`);
    }
    const perMinute = entry.quota.limits.find((limit) => limit.window === "minute" && limit.unit === "request");
    if (perMinute && entry.resilience.minRequestSpacingMs < MINUTE / perMinute.max) at(`request spacing ${entry.resilience.minRequestSpacingMs} ms exceeds the documented ${perMinute.max}/minute`);
    if (entry.resilience.maxRedirects !== 0) at("redirects must be refused");
    if (entry.resilience.deadlineMs <= 0 || entry.resilience.maxResponseBytes <= 0) at("deadline and body ceiling must be positive");
    if (entry.license.storage === "no-storage" && (entry.freshness.offerTtlMs !== 0 || entry.license.retentionMaxMs !== 0)) at("a no-storage source may not be served from or kept in any cache");
    if (entry.license.storage === "bounded" && entry.freshness.offerTtlMs > entry.license.retentionMaxMs) at("an observation may not be served longer than it may be kept");
    if (entry.authorityClass !== "sourcing_observation") at("unknown authority class");
    // [B19-E E2] OD-36: a disclosure decision is required, and a source Sirkit does not use is never disclosed to an agent
    const disclosure = (entry.license as { agentDisclosure?: unknown }).agentDisclosure;
    if (!AGENT_DISCLOSURES.includes(disclosure as AgentDisclosure)) at(`agentDisclosure is missing or not one of ${AGENT_DISCLOSURES.join("|")}`);
    else if (entry.state.status !== "enabled" && disclosure === "permitted") at(`agentDisclosure may not be "permitted" for a ${entry.state.status} source`);
    // [B19-E E2 review] the followable link the terms require is recorded, so every surface can show it with the data
    const attributionLink = (entry.license as { attributionLink?: unknown }).attributionLink;
    if (attributionLink === undefined) at("attributionLink is missing (null when the terms require no link)");
    else if (attributionLink !== null && (typeof attributionLink !== "string" || !ATTRIBUTION_LINK.test(attributionLink))) at("attributionLink must be a plain https link with no credentials, query or fragment");
    else if (attributionLink === null && /followable link/i.test(entry.license.attribution)) at("the attribution asks for a followable link, so attributionLink is required");
    // [B19-E E2] a candidate search calls a registered operation, returns at most 5 and observes only what the source may
    const search = (entry as { candidateSearch?: CandidateSearchPolicy | null }).candidateSearch;
    if (search === undefined) at("candidateSearch is missing (null when the source is never searched)");
    else if (search !== null) {
      if (entry.state.status !== "enabled") at("a source that is not enabled may not declare a candidate search");
      if (!entry.endpoints.operations.some((operation) => operation.method === "POST" && operation.url === search.operationUrl)) at(`candidate search operation ${search.operationUrl} is not a registered operation`);
      if (search.modes.length === 0 || new Set(search.modes).size !== search.modes.length || search.modes.some((mode) => !CANDIDATE_SEARCH_MODES.includes(mode))) at("candidate search modes must be a non-empty set of exact|keyword");
      if (!Number.isInteger(search.maxResults) || search.maxResults < 1 || search.maxResults > CANDIDATE_SEARCH_MAX_RESULTS) at(`a candidate search returns at most ${CANDIDATE_SEARCH_MAX_RESULTS} results`);
      if (search.cost !== "request" && search.cost !== "matched-parts-at-limit") at("candidate search cost is not request|matched-parts-at-limit");
      if (search.observations.length === 0) at("a candidate search observes nothing");
      for (const observation of search.observations) if (!entry.observations.includes(observation)) at(`candidate search observation ${observation} is not among the source's observations`);
    }
    if (SECRET_SHAPES.test(JSON.stringify(entry))) at("the entry contains something shaped like a secret value");
  }
  return errors;
}

// ── Rendering (the committed artifact) ───────────────────────────────────────

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value;
}

function duration(ms: number): string {
  if (ms === 0) return "0";
  if (ms % DAY === 0) return `${ms / DAY}d`;
  if (ms % HOUR === 0) return `${ms / HOUR}h`;
  if (ms % MINUTE === 0) return `${ms / MINUTE}m`;
  return `${ms}ms`;
}

export const SOURCE_REGISTRY_CSV_COLUMNS = [
  "registry_version", "id", "status", "owner_decision", "api", "api_version", "docs_checked_on", "hosts", "operations", "candidate_search", "auth_method", "secret_references",
  "secret_query_params", "observations", "quota", "quota_basis", "request_spacing", "deadline", "max_response_bytes", "redirects", "automatic_retries",
  "breaker", "served_for", "storage", "retention", "retention_basis", "bulk_refresh", "export_disposition", "agent_disclosure", "repository_commit", "attribution", "attribution_link",
  "region", "currency", "source_class", "authority_class", "never_proves",
] as const;

export function renderSourceRegistryCsv(entries: readonly SourceRegistryEntry[] = ENTRIES): string {
  const lines = [SOURCE_REGISTRY_CSV_COLUMNS.join(",")];
  for (const entry of entries) {
    const row = [
      SOURCE_REGISTRY_VERSION,
      entry.id,
      entry.state.status,
      entry.state.ownerDecision ?? "",
      entry.provider.api,
      entry.provider.apiVersion,
      entry.provider.documentationCheckedOn,
      entry.endpoints.hosts.join(";"),
      entry.endpoints.operations.map((operation) => `${operation.method} ${operation.url}`).join(";"),
      entry.candidateSearch ? `${entry.candidateSearch.modes.join("|")}; max ${entry.candidateSearch.maxResults}; cost ${entry.candidateSearch.cost}; observes ${entry.candidateSearch.observations.join("|")}` : "",
      entry.auth.method,
      entry.auth.secrets.map((reference) => [reference.env, ...reference.fallbacks].join("|")).join(";"),
      entry.auth.secretQueryParams.join(";"),
      entry.observations.join(";"),
      entry.quota.limits.map((limit) => `${limit.max}/${limit.window} ${limit.unit}`).join(";"),
      entry.quota.basis,
      duration(entry.resilience.minRequestSpacingMs),
      duration(entry.resilience.deadlineMs),
      String(entry.resilience.maxResponseBytes),
      String(entry.resilience.maxRedirects),
      String(entry.resilience.retry.automaticRetries),
      `${entry.resilience.breaker.consecutiveFailuresToOpen} failures -> open ${duration(entry.resilience.breaker.openMs)}`,
      duration(entry.freshness.offerTtlMs),
      entry.license.storage,
      duration(entry.license.retentionMaxMs),
      entry.license.retentionBasis,
      entry.license.bulkRefresh,
      entry.license.exportDisposition,
      entry.license.agentDisclosure,
      entry.license.repositoryCommit,
      entry.license.attribution,
      entry.license.attributionLink ?? "",
      entry.scope.region,
      entry.scope.currency,
      entry.sourceClass,
      entry.authorityClass,
      ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING.join(";"),
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
