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
 *
 * [B20 A4] An approved external MCP tool's result (`sirkit.mcp-observation.v1`) enters as the source class `external_mcp_tool`,
 * QUARANTINED for every property whatever it names (OD-79): never a candidate, a hint, a sourcing fact or a conflict, and it
 * never clears missing evidence. `candidateFromMcpObservation` reads each value from the record itself at a validated pointer.
 */
import type { EngineeringFacet, ExtractionMethod, SourceClass } from "../atomic/types";
import type { McpObservationRecord } from "../mcp/observation";
import { canonicalExactMpn } from "../atomic/identity";
import { inertExternalText, safeExternalHref } from "../net/external-href";
import { canonicalJson, contentId, deepFreeze, sha256 } from "../atomic/stable";
import type { PartPricing } from "../distributors/types";
import { SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION, sourceForDistributorName, type AcquisitionSourceId } from "./source-registry";

export const QUARANTINE_SCHEMA_VERSION = 1;
export const DISTRIBUTOR_NORMALIZER_VERSION = "sirkit.distributor-normalizer/1";
/** [B19-E E4] Bounds on what a document or CAD extraction may put into a fact. */
export const EXTRACTION_VALUE_MAX_LENGTH = 2_000;
/** [B19-E E4 review] A terminal (pin-to-pad) table is kept whole up to the publication request body's own bound (64 KiB): a
 *  reviewer must never see a partial table beside a draft assembled from the whole one. */
export const EXTRACTION_PIN_MAP_MAX_LENGTH = 64 * 1024;
export const EXTRACTION_LOCATOR_MAX_LENGTH = 500;
export const EXTRACTION_MAX_FACTS = 256;

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
/** [B20 A4] The one reason every fact read from an external MCP tool carries (OD-79). */
export const MCP_QUARANTINE_REASON = "read from an external MCP tool: quarantined for every property; never a candidate, a hint, a sourcing fact or a conflict (OD-79)";

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

export function observationFromPricing(pricing: PartPricing, input: { rawContentHash: string | null; retrievedAt: Date; requestedMpn?: string }): Readonly<ExternalObservation> {
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
    // [B19-D I5b row 40] what was ASKED, kept beside what the vendor answered with
    queriedMpn: input.requestedMpn?.trim() || pricing.mpn,
    retrievedAt,
    expiresAt: new Date(input.retrievedAt.getTime() + entry.freshness.offerTtlMs).toISOString(),
    rawContentHash: input.rawContentHash,
    rawRetained: false,
    normalizerVersion: DISTRIBUTOR_NORMALIZER_VERSION,
    values: {
      // [B19-D I5b row 41] vendor text is made inert and only plain web links survive; a dropped value is null, never "fixed"
      mpn: pricing.mpn.trim(),
      manufacturer: inertExternalText(pricing.manufacturer, 200),
      description: inertExternalText(pricing.description, 500),
      datasheetUrl: safeExternalHref(pricing.datasheet, "document"),
      productUrl: safeExternalHref(pricing.productUrl, "page"),
      distributorSku: inertExternalText(pricing.sku ?? null, 100),
      packaging: inertExternalText(pricing.package, 100),
      stock: pricing.inStock,
      minimumOrderQuantity: pricing.minOrderQty,
      priceBreaks: pricing.priceBreaks.map((item) => ({ quantity: item.qty, unitPrice: item.price, currency: item.currency })),
      lifecycle: pricing.lifecycleStatus,
      lifecycleRaw: inertExternalText(pricing.lifecycleRaw, 100),
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
  /** [B19-D I5b row 40] read from a document revision that a newer revision has replaced */
  superseded: boolean;
  /** [B19-D I5b row 40] the MPN that was asked for, when it differs from the one the source answered with */
  requestedMpn: string | null;
}

function classify(property: string, sourceClass: SourceClass, method: ExtractionMethod): { establishes: FactEstablishes; reason?: string } {
  // [B20 A4] FIRST: an external MCP tool's fact is quarantined whatever its property or method (OD-79)
  if (sourceClass === "external_mcp_tool") return { establishes: "quarantined", reason: MCP_QUARANTINE_REASON };
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

function candidate(exactMpn: string, facts: CandidateFact[], observationIds: string[], expiresAt: string | null, extra: { superseded?: boolean; requestedMpn?: string | null } = {}): Readonly<NormalizedCandidate> {
  // [B19-D I5b row 27a] identity is the EXACT published MPN (every suffix character counts; a confusable spelling is refused),
  // never the letters-and-digits search key that merged MAX3232CSE+ with MAX3232CSE
  const identityKey = canonicalExactMpn(exactMpn);
  const body = { schemaVersion: QUARANTINE_SCHEMA_VERSION, identityKey, exactMpn, facts: sortFacts(facts), observationIds: [...observationIds].sort(), expiresAt, superseded: extra.superseded === true, requestedMpn: extra.requestedMpn ?? null } as const;
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
  // [B19-D I5b row 40] an answer spelled differently from the request records the request, and the bundle reports the mismatch
  let requestedMpn: string | null = null;
  try {
    requestedMpn = canonicalExactMpn(observation.queriedMpn) === canonicalExactMpn(v.mpn) ? null : observation.queriedMpn;
  } catch {
    requestedMpn = observation.queriedMpn;
  }
  if (requestedMpn !== null) facts.push({ ...base, sourceId: "request", property: "mpn", facet: "identity", value: requestedMpn, establishes: "identity_hint", locator: "request" });
  return candidate(v.mpn, facts, [observation.id], observation.expiresAt, { requestedMpn });
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
  /** [B19-D I5b row 40] the document's revision, and the revision that replaced it, if any */
  sourceRevision?: string;
  supersededBy?: string | null;
}): Readonly<NormalizedCandidate> {
  if (!/^[0-9a-f]{64}$/.test(input.documentHash)) throw new Error("documentHash must be a lowercase SHA-256");
  if (!input.parserVersion.trim()) throw new Error("an extraction must name its parser version");
  if (input.facts.length > EXTRACTION_MAX_FACTS) throw new Error(`an extraction carries at most ${EXTRACTION_MAX_FACTS} facts`);
  const documentId = contentId("document", input.documentHash);
  const facts = input.facts.map((fact): CandidateFact => {
    // [B19-E E4] a document's text is as untrusted as a vendor's: made inert and bounded before it becomes a fact; a value or
    // locator that is nothing but invisible characters is refused, never kept blank
    const locator = inertExternalText(fact.locator, EXTRACTION_LOCATOR_MAX_LENGTH);
    if (locator === null) throw new Error(`fact ${fact.property} needs a source locator`);
    const value = typeof fact.value === "string" ? inertExternalText(fact.value, fact.property === "pin_mapping" ? EXTRACTION_PIN_MAP_MAX_LENGTH : EXTRACTION_VALUE_MAX_LENGTH) : fact.value;
    if (value === null) throw new Error(`fact ${fact.property} has no value`);
    return { ...fact, value, locator, observationId: documentId, sourceId: input.sourceId, sourceClass: input.sourceClass, method: input.method, parserVersion: input.parserVersion, ...classify(fact.property, input.sourceClass, input.method) };
  });
  return candidate(input.exactMpn, facts, [documentId], null, { superseded: typeof input.supersededBy === "string" && input.supersededBy.trim() !== "" });
}

/** [B20 A4] Why `candidateFromMcpObservation` built no candidate (closed). */
export type McpCandidateRefusal = "observation_invalid" | "mpn_invalid" | "too_many_facts" | "pointer_invalid" | "value_absent";
const MCP_POINTER = /^(\/[A-Za-z0-9_.-]{1,64}){0,8}$/;
const MCP_OBSERVATION_ID = /^external_tool_observation_[0-9a-f]{64}$/;
const MCP_SERVER_ID = /^[a-z0-9][a-z0-9-]{1,30}$/;
const MCP_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const MCP_ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A pointer resolved against the record's kept value, own properties only: a string, number or boolean leaf, or nothing. */
function pointedLeaf(value: unknown, pointer: string): string | number | boolean | null {
  let current: unknown = value;
  for (const step of pointer === "" ? [] : pointer.slice(1).split("/")) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]{0,5})$/.test(step)) return null;
      current = current[Number(step)];
    } else if (current !== null && typeof current === "object" && Object.hasOwn(current, step)) {
      current = (current as Record<string, unknown>)[step];
    } else {
      return null;
    }
  }
  if (typeof current === "string" || typeof current === "boolean") return current;
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

/**
 * [B20 A4] The facts an approved external MCP tool's observation states, each QUARANTINED (OD-79). Every value is READ FROM THE
 * RECORD at a validated pointer into its kept structured value (`structured.state === "kept"`) — a caller names a property, a
 * facet and a pointer, never a value — and made inert and bounded; the locator is `mcp:<serverId>/<toolName>#<pointer>`, the
 * candidate expires at the observation's `freshUntil`. Refuses with a closed code and never throws. No production caller in B20.
 */
export function candidateFromMcpObservation(observation: McpObservationRecord, request: { exactMpn: string; facts: ReadonlyArray<{ property: string; facet: EngineeringFacet; pointer: string }> }): { ok: true; candidate: Readonly<NormalizedCandidate> } | { ok: false; code: McpCandidateRefusal } {
  try {
    const record = observation as unknown as Record<string, unknown>;
    const source = record?.source as Record<string, unknown> | undefined;
    const tool = record?.tool as Record<string, unknown> | undefined;
    if (record === null || typeof record !== "object" || typeof record.id !== "string" || !MCP_OBSERVATION_ID.test(record.id) || record.schema !== "sirkit.mcp-observation.v1") return { ok: false, code: "observation_invalid" };
    if (typeof source !== "object" || source === null || source.sourceClass !== "external_mcp_tool" || typeof source.serverId !== "string" || !MCP_SERVER_ID.test(source.serverId)) return { ok: false, code: "observation_invalid" };
    if (typeof tool !== "object" || tool === null || typeof tool.name !== "string" || !MCP_TOOL_NAME.test(tool.name)) return { ok: false, code: "observation_invalid" };
    if (typeof record.freshUntil !== "string" || !MCP_ISO_TIME.test(record.freshUntil) || typeof record.normalizerVersion !== "string") return { ok: false, code: "observation_invalid" };
    const facts = request?.facts;
    if (!Array.isArray(facts)) return { ok: false, code: "observation_invalid" };
    if (facts.length > EXTRACTION_MAX_FACTS) return { ok: false, code: "too_many_facts" };
    let exactMpn: string;
    try {
      exactMpn = canonicalExactMpn(request.exactMpn);
    } catch {
      return { ok: false, code: "mpn_invalid" };
    }
    const structured = record.structured as { state?: unknown; untrustedValue?: unknown } | undefined;
    const kept = structured !== undefined && structured !== null && structured.state === "kept" ? structured.untrustedValue : undefined;
    const base = { observationId: record.id, sourceId: `mcp:${source.serverId}`, sourceClass: "external_mcp_tool" as const, method: "structured_api" as const, parserVersion: record.normalizerVersion };
    const built: CandidateFact[] = [];
    for (const fact of facts) {
      const pointer: unknown = fact?.pointer;
      if (typeof pointer !== "string" || pointer.length > 600 || !MCP_POINTER.test(pointer)) return { ok: false, code: "pointer_invalid" };
      if (typeof fact.property !== "string" || fact.property === "" || fact.property.length > 64) return { ok: false, code: "pointer_invalid" };
      const leaf = kept === undefined ? null : pointedLeaf(kept, pointer);
      if (leaf === null) return { ok: false, code: "value_absent" };
      const value = typeof leaf === "string" ? inertExternalText(leaf, EXTRACTION_VALUE_MAX_LENGTH) : leaf;
      if (value === null) return { ok: false, code: "value_absent" };
      built.push({ ...base, property: fact.property, facet: fact.facet, value, locator: `mcp:${source.serverId}/${tool.name}#${pointer}`, ...classify(fact.property, "external_mcp_tool", "structured_api") });
    }
    return { ok: true, candidate: candidate(exactMpn, built, [record.id], record.freshUntil) };
  } catch {
    return { ok: false, code: "observation_invalid" };
  }
}

// ── 3. Verified evidence bundle ──────────────────────────────────────────────

/** [B19-E E4] One disagreeing value, per what its facts may establish and their source class. */
export interface EvidenceConflictValue {
  value: string;
  establishes: FactEstablishes;
  sourceClass: SourceClass;
  sourceIds: string[];
  observationIds: string[];
}

export interface EvidenceConflict {
  property: string;
  values: EvidenceConflictValue[];
}

/** [B19-E E4] A quarantined fact that disagrees with another fact: information for the reviewer, never a conflict. */
export interface QuarantinedDisagreement {
  property: string;
  values: EvidenceConflictValue[];
}

export interface EvidenceBundle {
  schemaVersion: typeof QUARANTINE_SCHEMA_VERSION;
  id: string;
  identityKey: string;
  exactMpns: string[];
  sourcing: CandidateFact[];
  identityHints: CandidateFact[];
  /** [B19-E E4] an MPN or manufacturer from an engineering-authority source (e.g. a person-entered datasheet citation) */
  identityCandidates: CandidateFact[];
  quarantined: CandidateFact[];
  conflicts: EvidenceConflict[];
  quarantinedDisagreements: QuarantinedDisagreement[];
  staleObservationIds: string[];
  /** [B19-E E4] the documents a newer revision replaced (also stale) */
  supersededObservationIds: string[];
  parserVersions: string[];
  engineering: {
    proven: false;
    provenBy: "a reviewed atomic revision (app/lib/atomic), never a bundle";
    candidates: CandidateFact[];
    missing: string[];
  };
}

/** Properties whose disagreement across sources is a conflict a reviewer must resolve (prices and stock legitimately differ). */
// [B19-D I5b rows 39, 40] every engineering property, plus identity and lifecycle, and a requested-versus-answered MPN
const CONFLICT_PROPERTIES = [...new Set(["mpn", "manufacturer", "lifecycle", ...ENGINEERING_PROPERTIES])] as const;

/** [B19-E E4] exported: the review projection groups a conflict's facts by the same key */
export function conflictKey(property: string, value: CandidateFact["value"]): string {
  const text = typeof value === "string" ? value : canonicalJson(value);
  if (property === "mpn") {
    try {
      return canonicalExactMpn(text); // [B19-D I5b review] case alone is never an MPN conflict
    } catch {
      return text.trim();
    }
  }
  return property === "manufacturer" ? text.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ") : text.trim();
}

/** [B19-E E4] Facts grouped by conflict key, then by what they establish and their class: each group is one value. */
function valuesFor(property: string, facts: readonly CandidateFact[]): Map<string, EvidenceConflictValue[]> {
  type Slot = { value: string; establishes: FactEstablishes; sourceClass: SourceClass; sourceIds: Set<string>; observationIds: Set<string> };
  const byKey = new Map<string, Map<string, Slot>>();
  for (const fact of facts) {
    const key = conflictKey(property, fact.value);
    const groups = byKey.get(key) ?? new Map<string, Slot>();
    const groupKey = `${fact.establishes}|${fact.sourceClass}`;
    const slot = groups.get(groupKey) ?? { value: typeof fact.value === "string" ? fact.value : canonicalJson(fact.value), establishes: fact.establishes, sourceClass: fact.sourceClass, sourceIds: new Set<string>(), observationIds: new Set<string>() };
    slot.sourceIds.add(fact.sourceId);
    slot.observationIds.add(fact.observationId);
    groups.set(groupKey, slot);
    byKey.set(key, groups);
  }
  return new Map([...byKey].map(([key, groups]) => [key, [...groups.values()].map((slot) => ({ value: slot.value, establishes: slot.establishes, sourceClass: slot.sourceClass, sourceIds: [...slot.sourceIds].sort(), observationIds: [...slot.observationIds].sort() }))]));
}

function sortValues(values: EvidenceConflictValue[]): EvidenceConflictValue[] {
  return values.sort((a, b) => a.value.localeCompare(b.value) || a.sourceClass.localeCompare(b.sourceClass) || a.establishes.localeCompare(b.establishes));
}

export function buildEvidenceBundle(candidates: readonly NormalizedCandidate[], now: Date): Readonly<EvidenceBundle> {
  if (candidates.length === 0) throw new Error("An evidence bundle needs at least one candidate");
  const identityKey = candidates[0]!.identityKey;
  if (candidates.some((item) => item.identityKey !== identityKey)) throw new Error("Candidates for different parts cannot share an evidence bundle");
  const facts = sortFacts(candidates.flatMap((item) => item.facts));

  const conflicts: EvidenceConflict[] = [];
  const quarantinedDisagreements: QuarantinedDisagreement[] = [];
  for (const property of CONFLICT_PROPERTIES) {
    const ofProperty = facts.filter((fact) => fact.property === property);
    // conflicts are judged among the facts that could be put to a reviewer, not among quarantined ones
    const considered = valuesFor(property, ofProperty.filter((fact) => fact.establishes !== "quarantined"));
    if (considered.size > 1) conflicts.push({ property, values: sortValues([...considered.values()].flat()) });
    // [B19-E E4] a quarantined fact that disagrees with any other fact is reported for the reviewer, never counted as a conflict
    const all = valuesFor(property, ofProperty);
    if (all.size > 1 && ofProperty.some((fact) => fact.establishes === "quarantined")) quarantinedDisagreements.push({ property, values: sortValues([...all.values()].flat()) });
  }

  // [B19-E E4] what is missing is judged from current evidence only: a document a newer revision replaced clears nothing
  const currentFacts = candidates.filter((item) => !item.superseded).flatMap((item) => item.facts);
  const candidatesForReview = facts.filter((fact) => fact.establishes === "engineering_candidate" && (ENGINEERING_PROPERTIES as readonly string[]).includes(fact.property));
  const has = (property: string) => currentFacts.some((fact) => fact.property === property && fact.establishes === "engineering_candidate");
  const missing: string[] = [];
  if (!currentFacts.some((fact) => fact.establishes === "engineering_candidate")) missing.push("manufacturer datasheet or CAD evidence");
  if (!has("symbol")) missing.push("symbol");
  if (!has("footprint")) missing.push("footprint");
  if (!has("pin_mapping")) missing.push("pin-to-pad mapping");

  const superseded = candidates.filter((item) => item.superseded).flatMap((item) => item.observationIds);
  const stale = candidates.filter((item) => item.superseded || (item.expiresAt !== null && Date.parse(item.expiresAt) <= now.getTime())).flatMap((item) => item.observationIds);
  const body: Omit<EvidenceBundle, "id"> = {
    schemaVersion: QUARANTINE_SCHEMA_VERSION,
    identityKey,
    exactMpns: [...new Set(candidates.map((item) => item.exactMpn))].sort(),
    sourcing: facts.filter((fact) => fact.establishes === "sourcing"),
    identityHints: facts.filter((fact) => fact.establishes === "identity_hint"),
    identityCandidates: facts.filter((fact) => fact.establishes === "engineering_candidate" && IDENTITY_PROPERTIES.has(fact.property)),
    quarantined: facts.filter((fact) => fact.establishes === "quarantined"),
    conflicts,
    quarantinedDisagreements,
    staleObservationIds: [...new Set(stale)].sort(),
    supersededObservationIds: [...new Set(superseded)].sort(),
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
