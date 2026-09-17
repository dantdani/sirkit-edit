/**
 * [B19-E E6] The SERVER port behind the agent's two external read tools (sirkit.parts.external-search, sirkit.parts.evidence-read).
 *
 * Server only: it reaches the offer cache, the admitted distributor connectors and the atomic catalog, so the chat route reaches it
 * through exactly one file, app/api/chat/external-acquisition-runtime.ts (the chat import-closure ratchet pins that), and nothing
 * the browser loads imports it. It composes what earlier increments built:
 *  - per registered source, admission (admitSource) and the agent's pause (currentPause), reported as closed codes: blocked,
 *    disabled, operator_disabled, not_configured, terms_unconfirmed, paused. An environment variable is never named;
 *  - lookupExactMpns: cache first, and a live lookup only for the misses, only at a source whose registry entry PERMITS agent
 *    disclosure (OD-36) and only when the server's live policy allows, within the run's live-MPN budget and the agent's quota
 *    share (OD-40); an answer late for the deadline is pending;
 *  - the quarantine front half (observationFromPricing, candidateFromObservation, buildEvidenceBundle) and the E4 import-review
 *    projection, from the offer cache only;
 *  - E3's loadAtomicRevisionStatus with E5's successor chains, for each published revision of the exact MPN.
 * What leaves it is labels, plus vendor values under untrustedVendorText (bounded) for a permitting source only. It writes
 * nothing. The agent boundary (app/lib/agent/acquisition-reads.ts) projects the answer again before the model sees any of it.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { atomicExactParts, atomicPartRevisions } from "../db/schema";
import { fixtureRuntimeEnabled } from "../fixture-runtime/mode";
import { lookupExactMpns, type ExactMpnLookupOptions, type ExactMpnLookupResult } from "../distributors";
import type { PartPricing } from "../distributors/types";
import { canonicalExactMpn, sameExactMpn } from "../atomic/identity";
import { loadAtomicRevisionStatus } from "../atomic/server-catalog";
import { resolveSuccessorChains, type AtomicRevisionStatus } from "../atomic/revision-status";
import { boundUntrustedText } from "../untrusted-text";
import { currentPause } from "./admission-control";
import { buildImportReviewEvidence, importReviewProfileNeeds } from "./import-review";
import { loadCachedExternalObservations } from "./offer-cache-observations";
import { buildEvidenceBundle, candidateFromObservation, observationFromPricing, type ExternalObservation } from "./quarantine";
import { admitSource, SOURCE_IDS, SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION, validateSourceRegistry, type AcquisitionSourceId, type SourceRegistryEntry } from "./source-registry";
import type {
  ExternalAcquisitionReadPort,
  ExternalEvidencePortAnswer,
  ExternalEvidencePortRequest,
  ExternalMpnOutcome,
  ExternalSearchPortAnswer,
  ExternalSearchPortRequest,
  ExternalVendorValues,
} from "../agent/acquisition-reads";

export type { ExternalAcquisitionReadPort } from "../agent/acquisition-reads";

/** The server's policy for one chat run (decided by the route from the trusted request context, never by the model). */
export interface AgentReadPortPolicy {
  /** May this run's agent lookups ask a vendor at all? Still only where the source permits disclosure. */
  live: boolean;
}

export interface AgentReadPortOptions extends AgentReadPortPolicy {
  env?: Readonly<Record<string, string | undefined>>;
  clock?: () => number;
  /**
   * TEST SEAM: a registry revision to read agent disclosure from (a test-only registry). Production reads the committed registry.
   * A revision that fails validateSourceRegistry permits nothing; admission always uses the committed registry.
   */
  registry?: Readonly<Record<AcquisitionSourceId, SourceRegistryEntry>>;
  connect?: ExactMpnLookupOptions["connect"];
  readOfferCache?: ExactMpnLookupOptions["readOfferCache"];
  loadObservations?: (exactMpn: string, now: Date) => Promise<readonly ExternalObservation[]>;
  loadRevisionIds?: (exactMpn: string) => Promise<readonly string[]>;
  loadRevisionStatus?: (revisionIds: readonly string[]) => Promise<ReadonlyMap<string, AtomicRevisionStatus>>;
}

const MAX_MPNS = 5;
const MAX_LIVE_MPNS = 5;
const MAX_EVIDENCE_OBSERVATIONS = 8;
const MAX_REVISIONS = 8;
const EVIDENCE_PROFILE = "pcb_assignable" as const;

/** Which sources this port may disclose values from and ask live for the agent. */
function disclosurePermits(options: AgentReadPortOptions): (id: AcquisitionSourceId) => boolean {
  const registry = options.registry ?? SOURCE_REGISTRY;
  const valid = registry === SOURCE_REGISTRY || (SOURCE_IDS.every((id) => registry[id]?.id === id) && validateSourceRegistry(SOURCE_IDS.map((id) => registry[id])).length === 0);
  return (id) => valid && SOURCE_REGISTRY[id].state.status === "enabled" && registry[id].state.status === "enabled" && registry[id].license.agentDisclosure === "permitted";
}

function canonicalList(mpns: readonly string[], max: number): string[] {
  const out: string[] = [];
  for (const mpn of mpns) {
    try {
      const canonical = canonicalExactMpn(mpn);
      if (!out.includes(canonical)) out.push(canonical);
    } catch {
      // a confusable spelling is never looked up
    }
  }
  return out.slice(0, max);
}

const isoOf = (ms: number): string | null => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const finiteOrNull = (value: number | null | undefined): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const textOrNull = (value: string | null | undefined, max: number): string | null => {
  const bounded = typeof value === "string" ? boundUntrustedText(value, max) : "";
  return bounded === "" ? null : bounded;
};

/** Vendor values for a permitting source: through the quarantine front half (inert text), then bounded again; no link, no SKU. */
function untrustedValues(observation: ExternalObservation): ExternalVendorValues {
  const values = observation.values;
  return {
    manufacturer: textOrNull(values.manufacturer, 60),
    description: textOrNull(values.description, 120),
    packaging: textOrNull(values.packaging, 40),
    lifecycle: values.lifecycle === "unknown" ? null : textOrNull(values.lifecycle, 24),
    stock: finiteOrNull(values.stock),
    minimumOrderQuantity: finiteOrNull(values.minimumOrderQuantity),
    priceBreaks: values.priceBreaks.filter((item) => Number.isFinite(item.quantity) && Number.isFinite(item.unitPrice)).slice(0, 4).map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice, currency: textOrNull(item.currency, 8) ?? "USD" })),
  };
}

function observedLabel(id: AcquisitionSourceId, mpn: string, pricing: PartPricing, values: boolean): ExternalSearchPortAnswer["observations"][number] | null {
  const retrievedAtMs = pricing.provenance?.retrievedAt ?? pricing.evidence?.retrievedAt ?? pricing.fetchedAt;
  const retrievedAt = isoOf(retrievedAtMs);
  const expiresAt = isoOf(retrievedAtMs + SOURCE_REGISTRY[id].freshness.offerTtlMs);
  if (retrievedAt === null || expiresAt === null) return null;
  const servedFrom = pricing.provenance?.servedFrom ?? (pricing.evidence ? "live" : "offer-cache");
  let vendor: ExternalVendorValues | undefined;
  if (values) {
    try {
      const rawContentHash = pricing.evidence && /^[0-9a-f]{64}$/.test(pricing.evidence.rawContentHash) ? pricing.evidence.rawContentHash : null;
      vendor = untrustedValues(observationFromPricing(pricing, { rawContentHash, retrievedAt: new Date(retrievedAtMs), requestedMpn: mpn }));
    } catch {
      vendor = undefined; // an answer the quarantine front half refuses shows no values
    }
  }
  return { mpn, sourceId: id, outcome: "observed", servedFrom, retrievedAt, expiresAt, exactMatch: sameExactMpn(pricing.mpn, mpn), ...(vendor ? { untrustedVendorText: vendor } : {}) };
}

const OUTCOME_OF: Readonly<Record<string, ExternalMpnOutcome>> = Object.freeze({ not_cached: "not_cached", no_exact_answer: "no_exact_answer", pending: "pending", paused: "paused", unavailable: "no_exact_answer" });

/** [B19-E E6] external-search: 1-5 exact MPNs, labels per source and per MPN (the binding symbol of sirkit.parts.external-search). */
export async function searchExactMpnsForAgent(options: AgentReadPortOptions, request: ExternalSearchPortRequest): Promise<ExternalSearchPortAnswer> {
  const clock = options.clock ?? Date.now;
  const started = Date.now();
  const env = options.env ?? process.env;
  const permits = disclosurePermits(options);
  const mpns = canonicalList(request.mpns, MAX_MPNS);
  const budget = Number.isInteger(request.liveMpnBudget) ? Math.max(0, Math.min(MAX_LIVE_MPNS, request.liveMpnBudget)) : 0;
  const now = clock();
  const remainingMs = (): number => Math.max(1, request.deadlineMs - (Date.now() - started));
  const lookupOptions = (live: boolean): ExactMpnLookupOptions => ({
    live, purpose: "agent", deadlineMs: remainingMs(), signal: request.signal, clock, env,
    ...(options.connect ? { connect: options.connect } : {}),
    ...(options.readOfferCache ? { readOfferCache: options.readOfferCache } : {}),
  });

  const sources: ExternalSearchPortAnswer["sources"] = [];
  const asked: Array<{ id: AcquisitionSourceId; values: boolean; live: boolean; paused: boolean }> = [];
  for (const id of SOURCE_IDS) {
    const admission = admitSource(id, env);
    if (!admission.admitted) {
      sources.push({ sourceId: id, status: admission.refusal === "credentials_missing" ? "not_configured" : admission.refusal, retryAt: null, disclosure: "labels_only" });
      continue;
    }
    const values = permits(id);
    const pause = values && options.live ? currentPause(id, now, "agent") : null;
    sources.push({ sourceId: id, status: !values ? "terms_unconfirmed" : pause ? "paused" : "available", retryAt: pause ? isoOf(pause.retryAtMs) : null, disclosure: values ? "values" : "labels_only" });
    asked.push({ id, values, live: values && options.live && pause === null, paused: pause !== null });
  }

  // 1. the cache alone, at every admitted source
  const cached = await Promise.all(asked.map(async (source) => ({ source, result: await lookupExactMpns(source.id, mpns, lookupOptions(false)) })));
  // 2. the misses a live source may ask for, in request order, within the run's budget (an MPN counts once, whatever the sources)
  const wanted = mpns.filter((mpn) => cached.some(({ source, result }) => source.live && result.answers.some((answer) => answer.mpn === mpn && answer.outcome === "not_cached")));
  const allowed = new Set(wanted.slice(0, budget));
  const live = await Promise.all(cached.map(async ({ source, result }) => {
    const misses = result.answers.filter((answer) => answer.outcome === "not_cached" && allowed.has(answer.mpn)).map((answer) => answer.mpn);
    return { source, result: source.live && misses.length > 0 ? await lookupExactMpns(source.id, misses, lookupOptions(true)) : null };
  }));
  const liveMpns = new Set(live.flatMap(({ result }) => result?.liveMpns ?? []));

  const observations: ExternalSearchPortAnswer["observations"] = [];
  for (const mpn of mpns) {
    for (const { source, result } of cached) {
      const liveResult: ExactMpnLookupResult | null = live.find((item) => item.source.id === source.id)?.result ?? null;
      const answer = liveResult?.answers.find((item) => item.mpn === mpn) ?? result.answers.find((item) => item.mpn === mpn);
      if (!answer) continue;
      if ((answer.outcome === "cached" || answer.outcome === "live") && answer.pricing) {
        const label = observedLabel(source.id, mpn, answer.pricing, source.values);
        if (label) observations.push(label);
        continue;
      }
      let outcome: ExternalMpnOutcome = OUTCOME_OF[answer.outcome] ?? "no_exact_answer";
      if (answer.outcome === "not_cached" && source.paused) outcome = "paused";
      else if (answer.outcome === "not_cached" && source.live && !allowed.has(mpn)) outcome = "run_live_limit";
      observations.push({ mpn, sourceId: source.id, outcome, servedFrom: null, retrievedAt: null, expiresAt: null, exactMatch: false });
    }
  }
  return { registryVersion: SOURCE_REGISTRY_VERSION, liveMpnsUsed: Math.min(liveMpns.size, budget), sources, observations };
}

/** Each published revision of the exact MPN, newest first (a read of the atomic catalog). */
async function loadPublishedRevisionIdsForExactMpn(exactMpn: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: atomicPartRevisions.id })
    .from(atomicPartRevisions)
    .innerJoin(atomicExactParts, eq(atomicPartRevisions.exactPartId, atomicExactParts.id))
    .where(and(sql`upper(${atomicExactParts.exactMpn}) = ${exactMpn}`, eq(atomicPartRevisions.publicationState, "published")))
    .orderBy(desc(atomicPartRevisions.revision))
    .limit(MAX_REVISIONS);
  return rows.map((row) => row.id);
}

/** [B19-E E6] evidence-read: one exact MPN from the offer cache and the catalog, never a vendor (the binding symbol of sirkit.parts.evidence-read). */
export async function readEvidenceForAgent(options: AgentReadPortOptions, request: ExternalEvidencePortRequest): Promise<ExternalEvidencePortAnswer> {
  const clock = options.clock ?? Date.now;
  const permits = disclosurePermits(options);
  const mpn = canonicalExactMpn(request.mpn);
  const now = new Date(clock());

  const loaded = await (options.loadObservations ?? loadCachedExternalObservations)(mpn, now);
  // cache only: an observation from a live answer, from another part or refused by the quarantine front half is not evidence here
  const observations = loaded.filter((observation) => {
    try {
      return observation.rawContentHash === null && candidateFromObservation(observation).identityKey === mpn;
    } catch {
      return false;
    }
  }).sort((a, b) => SOURCE_IDS.indexOf(a.sourceId) - SOURCE_IDS.indexOf(b.sourceId) || a.retrievedAt.localeCompare(b.retrievedAt)).slice(0, MAX_EVIDENCE_OBSERVATIONS);
  const review = observations.length > 0 ? buildImportReviewEvidence(buildEvidenceBundle(observations.map(candidateFromObservation), now), observations, EVIDENCE_PROFILE) : null;
  const stale = new Set(review?.staleObservationIds ?? []);

  const loadStatus = options.loadRevisionStatus ?? loadAtomicRevisionStatus;
  const ids = [...new Set(await (options.loadRevisionIds ?? loadPublishedRevisionIdsForExactMpn)(mpn))].slice(0, MAX_REVISIONS);
  const statuses = ids.length > 0 ? await loadStatus(ids) : new Map<string, AtomicRevisionStatus>();
  const starts = new Map(ids.flatMap((id) => (statuses.has(id) ? [[id, statuses.get(id)!] as const] : [])));
  const chains = starts.size > 0 ? await resolveSuccessorChains(loadStatus, starts) : new Map();

  return {
    registryVersion: SOURCE_REGISTRY_VERSION,
    observations: observations.map((observation) => ({
      observationId: observation.id,
      sourceId: observation.sourceId,
      servedFrom: "offer-cache" as const,
      retrievedAt: observation.retrievedAt,
      expiresAt: observation.expiresAt,
      stale: stale.has(observation.id),
      exactMatch: sameExactMpn(observation.values.mpn, mpn),
      ...(permits(observation.sourceId) ? { untrustedVendorText: untrustedValues(observation) } : {}),
    })),
    conflicts: (review?.conflicts ?? []).map((conflict) => ({ property: conflict.property, kind: conflict.kind })),
    quarantinedDisagreements: [...new Set((review?.quarantinedDisagreements ?? []).map((item) => item.property))],
    missing: review ? [...review.missing] : importReviewProfileNeeds(EVIDENCE_PROFILE),
    staleObservationIds: [...stale],
    revisions: ids.flatMap((id) => {
      const status = starts.get(id);
      if (!status) return [];
      return [{ revisionId: id, state: status.state, selectable: status.selectable, pinnable: status.pinnable, successorRevisionId: status.successorRevisionId ?? null, selectableSuccessorRevisionId: chains.get(id)?.selectableSuccessorRevisionId ?? null }];
    }),
  };
}

/** A port over the given options (tests pass fakes; the runtime passes only the server's policy). */
export function createAgentReadPort(options: AgentReadPortOptions): ExternalAcquisitionReadPort {
  const fixed: AgentReadPortOptions = { ...options };
  return {
    searchExactMpns: (request) => searchExactMpnsForAgent(fixed, request),
    readEvidence: (request) => readEvidenceForAgent(fixed, request),
  };
}

/**
 * The production port for one chat run, or null to withhold both tools: the fixture runtime has no offer cache or vendor, and a
 * server without its database has neither. Only the presence of the database setting is checked; no value is read into anything.
 */
export function resolveAgentReadPort(policy: AgentReadPortPolicy): ExternalAcquisitionReadPort | null {
  if (fixtureRuntimeEnabled() || !process.env.DATABASE_URL) return null;
  return createAgentReadPort({ live: policy.live === true });
}
