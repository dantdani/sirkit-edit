/**
 * [B19-C I4] The front half of the quarantine-to-authority pipeline.
 *
 *   1. EXTERNAL OBSERVATION — what a source said, pinned to the source, the registry revision, the exact bytes it sent
 *      (a SHA-256; the raw content itself is never retained from a distributor) and the normalizer that read it.
 *   2. NORMALIZED CANDIDATE — the observation's facts, each classified by what its source and method may establish:
 *        sourcing               availability, price, packaging, a lifecycle claim;
 *        identity_hint          an MPN or manufacturer name as a distributor spelled it — helps find a part, proves nothing;
 *        engineering_candidate  a symbol, footprint, package or pin fact from an authoritative source by a deterministic
 *                               parser — still only a candidate for human review;
 *        quarantined            anything extracted by a model or OCR, and any engineering fact claimed by a source that
 *                               cannot establish it (a distributor catalog, downloaded third-party CAD, geometry inference).
 *   3. VERIFIED EVIDENCE BUNDLE — the facts for ONE part across sources, with conflicts, stale observations, parser
 *      versions, and the engineering evidence still missing.
 *
 * Stages 4 and 5 — the reviewed atomic revision and the published project binding — live in `app/lib/atomic` and need a
 * qualified human's review. Nothing in this module creates, approves or publishes a revision or binds a design, and a
 * bundle's `engineering.proven` is always false.
 */
import type { EngineeringFacet, ExtractionMethod, SourceClass } from "../atomic/types";
import { normalizeMpnSearchKey } from "../atomic/identity";
import { canonicalJson, contentId, deepFreeze, sha256 } from "../atomic/stable";
import type { PartPricing } from "../distributors/types";
import { SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION, sourceForDistributorName, type AcquisitionSourceId } from "./source-registry";

export const QUARANTINE_SCHEMA_VERSION = 1;
export const DISTRIBUTOR_NORMALIZER_VERSION = "sirkit.distributor-normalizer/1";

/** Source classes whose deterministic parse may yield an engineering CANDIDATE (review still required). */
export const ENGINEERING_CANDIDATE_SOURCE_CLASSES: readonly SourceClass[] = Object.freeze([
  "manufacturer_datasheet",
  "manufacturer_cad",
  "manufacturer_application_note",
  "official_kicad_library",
  "organization_authored",
  "human_reviewed",
]);

const UNTRUSTED_METHODS: readonly ExtractionMethod[] = ["llm", "ocr"];
const UNTRUSTED_CLASSES: readonly SourceClass[] = ["llm_suggestion", "ocr_extraction"];

export type FactEstablishes = "sourcing" | "identity_hint" | "engineering_candidate" | "quarantined";

/** Properties that are ENGINEERING facts: never established by sourcing data. */
export const ENGINEERING_PROPERTIES = Object.freeze(["symbol", "footprint", "pin_mapping", "package", "package_geometry", "terminal_function", "electrical_rating"] as const);
const SOURCING_PROPERTIES = new Set(["stock", "minimum_order_quantity", "price_breaks", "lifecycle", "packaging", "product_url", "distributor_sku", "datasheet_url", "description"]);
const IDENTITY_PROPERTIES = new Set(["mpn", "manufacturer"]);

// ── 1. External observation ──────────────────────────────────────────────────

export interface ExternalObservation {
  schemaVersion: typeof QUARANTINE_SCHEMA_VERSION;
  id: string;
  sourceId: AcquisitionSourceId;
  registryVersion: string;
  sourceClass: SourceClass;
  authorityClass: "sourcing_observation";
  queriedMpn: string;
  retrievedAt: string;
  expiresAt: string;
  /** SHA-256 of the exact response bytes, when the observation came from a live answer; null when served from a cache. */
  rawContentHash: string | null;
  rawRetained: false;
  normalizerVersion: string;
  values: {
    mpn: string;
    manufacturer: string | null;
    description: string | null;
    datasheetUrl: string | null;
    productUrl: string | null;
    distributorSku: string | null;
    packaging: string | null;
    stock: number | null;
    minimumOrderQuantity: number | null;
    priceBreaks: Array<{ quantity: number; unitPrice: number; currency: string }>;
    lifecycle: string;
    lifecycleRaw: string | null;
  };
}

export function observationFromPricing(pricing: PartPricing, input: { rawContentHash: string | null; retrievedAt: Date }): Readonly<ExternalObservation> {
  const entry = sourceForDistributorName(pricing.distributor);
  if (!entry) throw new Error(`${pricing.distributor} is not a registered source`);
  if (entry.state.status !== "enabled") throw new Error(`${entry.displayName} is ${entry.state.status} in the source registry; its data is not acquired`);
  if (input.rawContentHash !== null && !/^[0-9a-f]{64}$/.test(input.rawContentHash)) throw new Error("rawContentHash must be a lowercase SHA-256");
  const retrievedAt = input.retrievedAt.toISOString();
  const body: Omit<ExternalObservation, "id"> = {
    schemaVersion: QUARANTINE_SCHEMA_VERSION,
    sourceId: entry.id,
    registryVersion: SOURCE_REGISTRY_VERSION,
    sourceClass: entry.sourceClass,
    authorityClass: entry.authorityClass,
    queriedMpn: pricing.mpn,
    retrievedAt,
    expiresAt: new Date(input.retrievedAt.getTime() + entry.freshness.offerTtlMs).toISOString(),
    rawContentHash: input.rawContentHash,
    rawRetained: false,
    normalizerVersion: DISTRIBUTOR_NORMALIZER_VERSION,
    values: {
      mpn: pricing.mpn,
      manufacturer: pricing.manufacturer,
      description: pricing.description,
      datasheetUrl: pricing.datasheet,
      productUrl: pricing.productUrl,
      distributorSku: pricing.sku ?? null,
      packaging: pricing.package,
      stock: pricing.inStock,
      minimumOrderQuantity: pricing.minOrderQty,
      priceBreaks: pricing.priceBreaks.map((item) => ({ quantity: item.qty, unitPrice: item.price, currency: item.currency })),
      lifecycle: pricing.lifecycleStatus,
      lifecycleRaw: pricing.lifecycleRaw,
    },
  };
  return deepFreeze({ id: contentId("observation", sha256(canonicalJson(body))), ...body });
}

// ── 2. Normalized candidate ──────────────────────────────────────────────────

export interface CandidateFact {
  property: string;
  facet: EngineeringFacet;
  value: string | number | boolean | Array<{ quantity: number; unitPrice: number; currency: string }>;
  /** The observation (distributor) or document (extraction) this fact was read from. */
  observationId: string;
  sourceId: string;
  sourceClass: SourceClass;
  method: ExtractionMethod;
  parserVersion: string;
  locator: string;
  establishes: FactEstablishes;
  /** Why a fact is quarantined. */
  reason?: string;
}

export interface NormalizedCandidate {
  schemaVersion: typeof QUARANTINE_SCHEMA_VERSION;
  id: string;
  identityKey: string;
  exactMpn: string;
  facts: CandidateFact[];
  observationIds: string[];
  expiresAt: string | null;
}

function classify(property: string, sourceClass: SourceClass, method: ExtractionMethod): { establishes: FactEstablishes; reason?: string } {
  if (UNTRUSTED_METHODS.includes(method) || UNTRUSTED_CLASSES.includes(sourceClass)) {
    return { establishes: "quarantined", reason: "extracted by a model or OCR: quarantined until deterministic validation and review" };
  }
  const engineering = (ENGINEERING_PROPERTIES as readonly string[]).includes(property);
  if (engineering) {
    if (ENGINEERING_CANDIDATE_SOURCE_CLASSES.includes(sourceClass)) return { establishes: "engineering_candidate" };
    return { establishes: "quarantined", reason: `a ${sourceClass} source cannot establish ${property}` };
  }
  if (IDENTITY_PROPERTIES.has(property)) return { establishes: ENGINEERING_CANDIDATE_SOURCE_CLASSES.includes(sourceClass) ? "engineering_candidate" : "identity_hint" };
  if (SOURCING_PROPERTIES.has(property)) return { establishes: "sourcing" };
  return { establishes: "quarantined", reason: `unrecognized property ${property}` };
}

function sortFacts(facts: CandidateFact[]): CandidateFact[] {
  return [...facts].sort((a, b) => canonicalJson([a.property, a.sourceId, a.observationId, a.locator, a.value]).localeCompare(canonicalJson([b.property, b.sourceId, b.observationId, b.locator, b.value])));
}

function candidate(exactMpn: string, facts: CandidateFact[], observationIds: string[], expiresAt: string | null): Readonly<NormalizedCandidate> {
  const identityKey = normalizeMpnSearchKey(exactMpn);
  if (!identityKey) throw new Error("A candidate needs an MPN");
  const body = { schemaVersion: QUARANTINE_SCHEMA_VERSION, identityKey, exactMpn, facts: sortFacts(facts), observationIds: [...observationIds].sort(), expiresAt } as const;
  return deepFreeze({ id: contentId("candidate", sha256(canonicalJson(body))), ...body });
}

/** A distributor observation's facts: sourcing facts and identity hints, never engineering facts. */
export function candidateFromObservation(observation: ExternalObservation): Readonly<NormalizedCandidate> {
  const base = { observationId: observation.id, sourceId: observation.sourceId, sourceClass: observation.sourceClass, method: "structured_api" as const, parserVersion: observation.normalizerVersion, locator: `${observation.sourceId}:${observation.queriedMpn}` };
  const facts: CandidateFact[] = [];
  const push = (property: string, facet: EngineeringFacet, value: CandidateFact["value"] | null) => {
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return;
    facts.push({ ...base, property, facet, value, ...classify(property, observation.sourceClass, "structured_api") });
  };
  const v = observation.values;
  push("mpn", "identity", v.mpn);
  push("manufacturer", "identity", v.manufacturer);
  push("description", "identity", v.description);
  push("datasheet_url", "identity", v.datasheetUrl);
  push("product_url", "sourcing", v.productUrl);
  push("distributor_sku", "sourcing", v.distributorSku);
  push("packaging", "sourcing", v.packaging);
  push("stock", "sourcing", v.stock);
  push("minimum_order_quantity", "sourcing", v.minimumOrderQuantity);
  push("price_breaks", "sourcing", v.priceBreaks);
  if (v.lifecycle !== "unknown") push("lifecycle", "lifecycle", v.lifecycle);
  return candidate(v.mpn, facts, [observation.id], observation.expiresAt);
}

/**
 * Facts read from a document or CAD file (a datasheet, a manufacturer or third-party library): each is classified by its
 * source class and extraction method. Nothing here trusts a fact; the classification only says whether it may be put to a
 * reviewer as an engineering candidate or must stay quarantined.
 */
export function candidateFromExtraction(input: {
  exactMpn: string;
  sourceId: string;
  sourceClass: SourceClass;
  method: ExtractionMethod;
  parserVersion: string;
  documentHash: string;
  facts: Array<{ property: string; facet: EngineeringFacet; value: string | number | boolean; locator: string }>;
}): Readonly<NormalizedCandidate> {
  if (!/^[0-9a-f]{64}$/.test(input.documentHash)) throw new Error("documentHash must be a lowercase SHA-256");
  if (!input.parserVersion.trim()) throw new Error("an extraction must name its parser version");
  const documentId = contentId("document", input.documentHash);
  const facts = input.facts.map((fact): CandidateFact => {
    if (!fact.locator.trim()) throw new Error(`fact ${fact.property} needs a source locator`);
    return { ...fact, observationId: documentId, sourceId: input.sourceId, sourceClass: input.sourceClass, method: input.method, parserVersion: input.parserVersion, ...classify(fact.property, input.sourceClass, input.method) };
  });
  return candidate(input.exactMpn, facts, [documentId], null);
}

// ── 3. Verified evidence bundle ──────────────────────────────────────────────

export interface EvidenceConflict {
  property: string;
  values: Array<{ value: string; sourceIds: string[]; observationIds: string[] }>;
}

export interface EvidenceBundle {
  schemaVersion: typeof QUARANTINE_SCHEMA_VERSION;
  id: string;
  identityKey: string;
  exactMpns: string[];
  sourcing: CandidateFact[];
  identityHints: CandidateFact[];
  quarantined: CandidateFact[];
  conflicts: EvidenceConflict[];
  staleObservationIds: string[];
  parserVersions: string[];
  engineering: {
    proven: false;
    provenBy: "a reviewed atomic revision (app/lib/atomic), never a bundle";
    candidates: CandidateFact[];
    missing: string[];
  };
}

/** Properties whose disagreement across sources is a conflict a reviewer must resolve (prices and stock legitimately differ). */
const CONFLICT_PROPERTIES = ["manufacturer", "lifecycle", "package", "pin_mapping", "footprint", "symbol"] as const;

function conflictKey(property: string, value: CandidateFact["value"]): string {
  const text = typeof value === "string" ? value : canonicalJson(value);
  return property === "manufacturer" ? text.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ") : text.trim();
}

export function buildEvidenceBundle(candidates: readonly NormalizedCandidate[], now: Date): Readonly<EvidenceBundle> {
  if (candidates.length === 0) throw new Error("An evidence bundle needs at least one candidate");
  const identityKey = candidates[0]!.identityKey;
  if (candidates.some((item) => item.identityKey !== identityKey)) throw new Error("Candidates for different parts cannot share an evidence bundle");
  const facts = sortFacts(candidates.flatMap((item) => item.facts));

  const conflicts: EvidenceConflict[] = [];
  for (const property of CONFLICT_PROPERTIES) {
    // conflicts are judged among the facts that could be put to a reviewer, not among quarantined ones
    const considered = facts.filter((fact) => fact.property === property && fact.establishes !== "quarantined");
    const byValue = new Map<string, { value: string; sourceIds: Set<string>; observationIds: Set<string> }>();
    for (const fact of considered) {
      const key = conflictKey(property, fact.value);
      const slot = byValue.get(key) ?? { value: typeof fact.value === "string" ? fact.value : canonicalJson(fact.value), sourceIds: new Set<string>(), observationIds: new Set<string>() };
      slot.sourceIds.add(fact.sourceId);
      slot.observationIds.add(fact.observationId);
      byValue.set(key, slot);
    }
    if (byValue.size > 1) {
      conflicts.push({
        property,
        values: [...byValue.values()].map((slot) => ({ value: slot.value, sourceIds: [...slot.sourceIds].sort(), observationIds: [...slot.observationIds].sort() })).sort((a, b) => a.value.localeCompare(b.value)),
      });
    }
  }

  const candidatesForReview = facts.filter((fact) => fact.establishes === "engineering_candidate" && (ENGINEERING_PROPERTIES as readonly string[]).includes(fact.property));
  const has = (property: string) => candidatesForReview.some((fact) => fact.property === property);
  const missing: string[] = [];
  if (!facts.some((fact) => fact.establishes === "engineering_candidate")) missing.push("manufacturer datasheet or CAD evidence");
  if (!has("symbol")) missing.push("symbol");
  if (!has("footprint")) missing.push("footprint");
  if (!has("pin_mapping")) missing.push("pin-to-pad mapping");

  const stale = candidates.filter((item) => item.expiresAt !== null && Date.parse(item.expiresAt) <= now.getTime()).flatMap((item) => item.observationIds);
  const body: Omit<EvidenceBundle, "id"> = {
    schemaVersion: QUARANTINE_SCHEMA_VERSION,
    identityKey,
    exactMpns: [...new Set(candidates.map((item) => item.exactMpn))].sort(),
    sourcing: facts.filter((fact) => fact.establishes === "sourcing"),
    identityHints: facts.filter((fact) => fact.establishes === "identity_hint"),
    quarantined: facts.filter((fact) => fact.establishes === "quarantined"),
    conflicts,
    staleObservationIds: [...new Set(stale)].sort(),
    parserVersions: [...new Set(facts.map((fact) => fact.parserVersion))].sort(),
    engineering: {
      proven: false,
      provenBy: "a reviewed atomic revision (app/lib/atomic), never a bundle",
      candidates: candidatesForReview,
      missing,
    },
  };
  return deepFreeze({ id: contentId("evidence_bundle", sha256(canonicalJson(body))), ...body });
}

/** The registry entry an observation came from (for labels in the product). */
export function observationSource(observation: ExternalObservation) {
  return SOURCE_REGISTRY[observation.sourceId];
}
