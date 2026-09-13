/**
 * [B19-E E2] Bounded external candidate search — the human surface.
 *
 * A signed-in member searches the enabled sources (DigiKey, Nexar) by exact MPN or keyword, and each source answers at most
 * 5 candidates. Every rule below comes from the source registry or the egress boundary:
 *  - only a source the registry ADMITS and that declares a candidate search is asked. A blocked or disabled source (LCSC,
 *    Mouser) is never constructed, whatever keys are set;
 *  - cache first: a search is memoized in THIS PROCESS ONLY, keyed `<source>:search:<mode>:<query>`, until the source's
 *    offerTtlMs after the vendor answered, and never for a source whose terms prohibit storage. Nothing is written to the
 *    offer cache or any other store (DigiKey: no database may be built from its data). [B19-E E2 review] The memo belongs to
 *    the requester's trusted tenant and project: another tenant or project never learns that a string was searched, or
 *    when (a 64-character keyword can reveal design intent), and a search without that scope is never memoized;
 *  - a live search is the caller's grant (`live`), metered for its purpose. The agent may use at most 25% of each quota
 *    window and exact MPNs only (OD-40). A used-up quota or an open breaker answers "paused", with when to retry, before
 *    any request is sent;
 *  - every hit passes the quarantine front half (`observationFromPricing` → `candidateFromObservation`). It keeps the
 *    vendor's own MPN with an `exactMatch` flag, carries inert and bounded vendor text and only safe https links, and is
 *    labelled a sourcing observation, never engineering authority.
 * The egress boundary (host allowlist, deadline, body ceiling, no redirects) is unchanged: vendors are reached only through
 * the connectors' `distributorJson`, an API and never a page fetch.
 */
import { canonicalExactMpn, sameExactMpn } from "../atomic/identity";
import { inertExternalText, safeExternalHref } from "../net/external-href";
import { VENDOR_PAGE_HOSTS } from "../net/href-policy";
import { admittedDistributorClient } from "../distributors/clients";
import type { CandidateSearchAnswer, DistributorClient } from "../distributors/types";
import { makeCoalescer, previewAdmission, type AdmissionPurpose } from "./admission-control";
import { candidateFromObservation, observationFromPricing } from "./quarantine";
import { admitSource, SOURCE_IDS, SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION, type AcquisitionSourceId } from "./source-registry";
import {
  EXTERNAL_OBSERVATION_AUTHORITY,
  EXTERNAL_SEARCH_MAX_LIMIT,
  EXTERNAL_SEARCH_MAX_QUERY_LENGTH,
  EXTERNAL_SEARCH_MODES,
  type ExternalCandidateHit,
  type ExternalSearchMode,
  type ExternalSearchRefusalCode,
  type ExternalSearchRequest,
  type ExternalSearchResult,
  type ExternalSearchSourceStatus,
} from "./external-search-contract";

/** Builds the connector for an ADMITTED source from the secrets its admission returned. */
export type SearchConnect = (id: AcquisitionSourceId, secrets: Readonly<Record<string, string>>) => DistributorClient | null;

export interface ExternalSearchOptions {
  /** Live vendor search: the server's decision for an authenticated member, never a request flag. */
  live: boolean;
  purpose: AdmissionPurpose;
  /** [B19-E E2 review] The requester's TRUSTED tenant and project (the route's context, never a body): the memo's owner. */
  scope: Readonly<{ tenantId: string; projectId: string }>;
  env?: Readonly<Record<string, string | undefined>>;
  clock?: () => number;
  /** Default: the process-wide clients, so pricing and search share one token cache and request queue per source. */
  connect?: SearchConnect;
}

const TEXT_BOUNDS = { manufacturer: 100, description: 200, packaging: 60, currency: 8 } as const;
const MAX_PRICE_BREAKS = 8;
const MEMO_MAX_ENTRIES = 256;
/**
 * A link whose query names a credential is never shown, whoever put it there. [B19-E E2 review + follow-up] A bare `sig` is a
 * credential too (an Azure SAS signature on a blob datasheet link) — except on an octopart.com page link, where it is the tamper
 * check of Octopart's click-tracking links, the part-page link Nexar's terms require.
 */
const SECRET_PARAMETER = /^(key|auth|sig)$|api[-_]?key|access[-_]?key|token|secret|passw(or)?d|signature|credential|session/i;
const OCTOPART_PAGE_HOST = /(^|\.)octopart\.com$/i;
const REGISTERED_SECRET_PARAMETERS = new Set(SOURCE_IDS.flatMap((id) => SOURCE_REGISTRY[id].auth.secretQueryParams.map((name) => name.toLowerCase())));

type Slot = ExternalCandidateHit | "withheld";
type MemoEntry = { limit: number; expiresAt: number; slots: Slot[] };

const memo = new Map<string, MemoEntry>();
const coalesce = makeCoalescer<CandidateSearchAnswer>();

/** Test hook: forget every memoized search. */
export function clearExternalSearchMemo(): void {
  memo.clear();
}

function refusal(code: ExternalSearchRefusalCode, error: string): ExternalSearchResult {
  return { ok: false, code, error };
}

/** A source's status, labelled from the registry (its owner decision, freshness and the attribution its terms require). */
function sourceStatus(id: AcquisitionSourceId, status: ExternalSearchSourceStatus["status"]): ExternalSearchSourceStatus {
  const entry = SOURCE_REGISTRY[id];
  return { sourceId: id, displayName: entry.displayName, status, ownerDecision: entry.state.ownerDecision, retryAt: null, freshnessLabel: entry.freshness.label, attribution: entry.license.attribution, attributionLink: entry.license.attributionLink, servedFrom: null, hitCount: 0, withheldHits: 0 };
}

/** Printable ASCII, 1 to 64 characters once ASCII spaces and tabs are trimmed; anything else is refused, never cleaned. */
function boundedQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const query = raw.replace(/^[ \t]+|[ \t]+$/g, "");
  return query !== "" && query.length <= EXTERNAL_SEARCH_MAX_QUERY_LENGTH && /^[\x20-\x7e]+$/.test(query) ? query : null;
}

function searchLink(raw: string | null, kind: "page" | "document"): string | null {
  const href = safeExternalHref(raw, kind, kind === "page" ? VENDOR_PAGE_HOSTS : undefined);
  if (!href) return null;
  const url = new URL(href);
  if (url.protocol !== "https:") return null;
  for (const name of url.searchParams.keys()) {
    if (kind === "page" && name.toLowerCase() === "sig" && OCTOPART_PAGE_HOST.test(url.hostname)) continue;
    if (SECRET_PARAMETER.test(name) || REGISTERED_SECRET_PARAMETERS.has(name.toLowerCase())) return null;
  }
  return href;
}

const finiteOrNull = (value: number | null): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** One connector hit as a labelled observation, or "withheld" when it cannot be shown truthfully. */
function project(id: AcquisitionSourceId, answer: Extract<CandidateSearchAnswer, { ok: true }>, hit: Extract<CandidateSearchAnswer, { ok: true }>["hits"][number], query: string, mode: ExternalSearchMode): Slot {
  const entry = SOURCE_REGISTRY[id];
  const pricing = hit.pricing;
  // a hit from another source, or an MPN that is confusable or longer than any query, is never shown
  if (pricing.distributor !== entry.distributorName || typeof pricing.mpn !== "string" || pricing.mpn.trim().length > EXTERNAL_SEARCH_MAX_QUERY_LENGTH) return "withheld";
  try {
    canonicalExactMpn(pricing.mpn);
    const observation = observationFromPricing(pricing, { rawContentHash: answer.rawContentHash, retrievedAt: new Date(answer.retrievedAt), ...(mode === "exact" ? { requestedMpn: query } : {}) });
    const candidate = candidateFromObservation(observation);
    const values = observation.values;
    return {
      sourceId: id,
      sourceDisplayName: entry.displayName,
      attribution: entry.license.attribution,
      attributionLink: entry.license.attributionLink, // [B19-E E2 review] shown with every hit, product link or not
      mpn: values.mpn,
      exactMatch: hit.exactMatch && sameExactMpn(values.mpn, query),
      manufacturer: inertExternalText(values.manufacturer, TEXT_BOUNDS.manufacturer),
      description: inertExternalText(values.description, TEXT_BOUNDS.description),
      packaging: inertExternalText(values.packaging, TEXT_BOUNDS.packaging),
      lifecycle: values.lifecycle,
      stock: finiteOrNull(values.stock),
      minimumOrderQuantity: finiteOrNull(values.minimumOrderQuantity),
      priceBreaks: values.priceBreaks
        .filter((item) => Number.isFinite(item.quantity) && Number.isFinite(item.unitPrice))
        .slice(0, MAX_PRICE_BREAKS)
        .map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice, currency: inertExternalText(item.currency, TEXT_BOUNDS.currency) ?? "USD" })),
      productUrl: searchLink(values.productUrl, "page"),
      datasheetUrl: searchLink(values.datasheetUrl, "document"),
      servedFrom: "live",
      observedAt: Date.parse(observation.retrievedAt),
      expiresAt: Date.parse(observation.expiresAt),
      authority: EXTERNAL_OBSERVATION_AUTHORITY,
      observationId: observation.id,
      candidateId: candidate.id,
    };
  } catch {
    return "withheld";
  }
}

/** [B19-E E2 review] The memo owner from the trusted scope; null (never memoized) without a tenant and a project. */
function memoOwner(scope: ExternalSearchOptions["scope"] | undefined): string | null {
  if (!scope || typeof scope.tenantId !== "string" || typeof scope.projectId !== "string" || scope.tenantId === "" || scope.projectId === "") return null;
  return `${encodeURIComponent(scope.tenantId)}/${encodeURIComponent(scope.projectId)}`;
}

function memoGet(key: string, limit: number, now: number): MemoEntry | null {
  const entry = memo.get(key);
  if (!entry) return null;
  if (now >= entry.expiresAt) {
    memo.delete(key);
    return null;
  }
  return entry.limit >= limit ? entry : null;
}

function memoPut(key: string, entry: MemoEntry): void {
  memo.delete(key);
  memo.set(key, entry);
  while (memo.size > MEMO_MAX_ENTRIES) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
}

function settle(base: ExternalSearchSourceStatus, slots: Slot[], servedFrom: "live" | "process-memo"): { status: ExternalSearchSourceStatus; hits: ExternalCandidateHit[] } {
  const hits = slots.filter((slot): slot is ExternalCandidateHit => slot !== "withheld").map((hit) => (servedFrom === "live" ? hit : { ...hit, servedFrom }));
  return { status: { ...base, status: "available", servedFrom, hitCount: hits.length, withheldHits: slots.length - hits.length }, hits };
}

async function searchSource(id: AcquisitionSourceId, search: { query: string; mode: ExternalSearchMode; limit: number }, options: ExternalSearchOptions, env: Readonly<Record<string, string | undefined>>, now: number): Promise<{ status: ExternalSearchSourceStatus; hits: ExternalCandidateHit[] }> {
  const entry = SOURCE_REGISTRY[id];
  const base = sourceStatus(id, "available");
  // admission first: a blocked, disabled, switched-off or unconfigured source is never constructed (its reason is data; no env names)
  const admission = admitSource(id, env);
  if (!admission.admitted) return { status: { ...base, status: admission.refusal }, hits: [] };
  const policy = entry.candidateSearch;
  if (!policy || !policy.modes.includes(search.mode)) return { status: { ...base, status: "not_searchable" }, hits: [] };

  // [B19-E E2 review] the memo (and a joined in-flight search) is the requesting tenant and project's alone
  const owner = memoOwner(options.scope);
  const key = owner === null ? null : `${owner}|${id}:search:${search.mode}:${search.query}`;
  const remembered = key === null ? null : memoGet(key, search.limit, now);
  if (remembered) return settle(base, remembered.slots.slice(0, search.limit), "process-memo");
  if (!options.live) return { status: base, hits: [] };

  const cost = policy.cost === "request" ? 1 : search.limit;
  const pause = previewAdmission(id, cost, now, options.purpose);
  if (pause) return { status: { ...base, status: "paused", retryAt: pause.retryAtMs }, hits: [] };

  let client: DistributorClient | null = null;
  try {
    client = (options.connect ?? ((sourceId: AcquisitionSourceId) => admittedDistributorClient(sourceId)))(id, admission.secrets);
  } catch {
    client = null;
  }
  if (!client?.searchCandidates) return { status: { ...base, status: "failed" }, hits: [] };
  const connector = client;
  let answer: CandidateSearchAnswer;
  try {
    const run = () => connector.searchCandidates!(search.query, { mode: search.mode, limit: search.limit, purpose: options.purpose });
    answer = await (key === null ? run() : coalesce(`${options.purpose}:${key}:${search.limit}`, run));
  } catch {
    answer = { ok: false, message: "the search failed (details withheld)" };
  }
  if (!answer.ok) {
    return answer.paused
      ? { status: { ...base, status: "paused", retryAt: answer.retryAtMs ?? null }, hits: [] }
      : { status: { ...base, status: "failed" }, hits: [] };
  }
  const slots = answer.hits.slice(0, search.limit).map((hit) => project(id, answer, hit, search.query, search.mode));
  const ttl = entry.license.storage === "bounded" ? entry.freshness.offerTtlMs : 0;
  const expiresAt = answer.retrievedAt + ttl;
  if (key !== null && ttl > 0 && expiresAt > now) memoPut(key, { limit: search.limit, expiresAt, slots });
  return settle(base, slots, "live");
}

/** Search the registry's sources for up to `limit` candidates each. Never throws for a vendor failure. */
export async function searchExternalCandidates(request: ExternalSearchRequest, options: ExternalSearchOptions): Promise<ExternalSearchResult> {
  const mode = request.mode;
  if (!EXTERNAL_SEARCH_MODES.includes(mode)) return refusal("EXTERNAL_SEARCH_MODE_INVALID", "The search mode must be exact or keyword.");
  const trimmed = boundedQuery(request.query);
  if (trimmed === null) return refusal("EXTERNAL_SEARCH_QUERY_INVALID", `The query must be 1 to ${EXTERNAL_SEARCH_MAX_QUERY_LENGTH} printable ASCII characters.`);
  const limit = request.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > EXTERNAL_SEARCH_MAX_LIMIT) return refusal("EXTERNAL_SEARCH_LIMIT_INVALID", `The limit must be a whole number from 1 to ${EXTERNAL_SEARCH_MAX_LIMIT}.`);
  const requested: unknown = request.sources ?? SOURCE_IDS;
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > SOURCE_IDS.length || requested.some((id) => !(SOURCE_IDS as readonly unknown[]).includes(id))) {
    return refusal("EXTERNAL_SEARCH_SOURCES_INVALID", "The sources must name registered sources.");
  }
  // OD-40: the agent searches by exact MPN only
  if (options.purpose === "agent" && mode !== "exact") return refusal("EXTERNAL_SEARCH_MODE_NOT_PERMITTED", "The agent may search by exact MPN only.");

  const query = mode === "exact" ? canonicalExactMpn(trimmed) : trimmed;
  const now = (options.clock ?? Date.now)();
  const env = options.env ?? process.env;
  const sources = [...new Set(requested as AcquisitionSourceId[])];
  const answers = await Promise.all(sources.map((id) => searchSource(id, { query, mode, limit }, options, env, now).catch(() => ({ status: sourceStatus(id, "failed"), hits: [] }))));
  return {
    ok: true,
    query,
    mode,
    limit,
    live: options.live,
    registryVersion: SOURCE_REGISTRY_VERSION,
    authority: EXTERNAL_OBSERVATION_AUTHORITY,
    sources: answers.map((answer) => answer.status),
    hits: answers.flatMap((answer) => answer.hits),
    generatedAt: now,
  };
}
