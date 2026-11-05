/**
 * [PR-F fA] The MISSING-FACTS CHECKLIST of one unresolved instance, and its NEXT ACTIONS in order - the workflow item behind the
 * Schematic -> PCB refusal row (PcbEditor's SyncBlockersPanel / MissingPartsList) and the journey strip's "N missing part(s)".
 *
 * PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md section F: a missing part is never solved by inventing a plausible package or pin map.
 * Four classes are kept apart and never cross:
 *  - IDENTITY   manufacturer, exact MPN, package variant - from the catalog part record the instance was placed from (a KiCad
 *               library part, `app/lib/parts-cache.ts` / `app/lib/atomic/catalog-part-detail.ts`); a distributor's spelling is an
 *               identity HINT (quarantine.ts `identity_hint`): it may CONFLICT with the record, it never makes it known;
 *  - EVIDENCE   symbol, footprint, pin-to-pad mapping - the pcb_assignable approval profile's needs (import-review.ts
 *               PROFILE_NEEDS, mirrored verbatim in EVIDENCE_NEEDS and gate-tested equal): known ONLY from a published, never
 *               withdrawn atomic revision linked to the part's value (`atomicAssignments`), never from a footprint hint, a pin
 *               count or a vendor text;
 *  - STOCK AND PRICING  sourcing observations (external-search hits): shown as sourcing, labelled with their source, and
 *               NEVER proof of identity, package or pins (source-registry.ts ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING);
 *  - a THEORY symbol is not a physical part (F.5): every identity and evidence fact is unknown by construction.
 * Each fact is known / unknown / conflicting with the label of the source that decided it.
 *
 * The next actions reuse what exists, in F's order: (1) search the published local catalog (`POST /api/parts/search`, the Build
 * Library's catalog read; a hit's published exact revision is read from `GET /api/parts/[id]`), (2) search the admitted distributors
 * (`POST /api/parts/external-search`: an unavailable, paused or refused source answers that state as data, never a fake hit),
 * (3) request component review (the existing atomic publication request, `POST /api/components/atomic/publication submit_request`
 * through AtomicPublicationReviewSection; a human reviewer and a different administrator decide), (4) create an explicitly
 * UNVERIFIED draft (the SAME request path with the symbol/footprint references and profile pcb_assignable prefilled: the server
 * assembles the draft (`assembleAtomicDraft`) and it stays a pending request - NOT PCB-assignable until the deterministic mapping
 * checks and the human approval + publication pass). An action without a member-callable path, or without the facts it needs, is
 * `not_available` with its reason - never a fake result and never ok.
 *
 * Pure and browser-safe: no React, no clock, no network, no node modules.
 */
import { EXTERNAL_SEARCH_MAX_QUERY_LENGTH, type ExternalSearchSourceStatus } from "@/app/lib/acquisition/external-search-contract";
import { SERVED_FROM_WORDS, utcMinute } from "@/app/lib/acquisition/source-labels";
import { ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING } from "@/app/lib/acquisition/source-registry";
import { ATOMIC_PUBLICATION_ROUTE } from "@/app/lib/atomic/publication-review-contract";
import { normalizeValueKey } from "@/app/lib/atomic/value-key";
import type { UnresolvedInstance, UnresolvedInstanceMissing } from "@/app/lib/pcb-sync/unresolved-instances";

export const MISSING_FACTS_SCHEMA = "sirkit.missing-facts-checklist.v1" as const;

export type MissingFactClass = "identity" | "evidence" | "stock_pricing";
export type MissingFactState = "known" | "unknown" | "conflicting";
export type MissingFactId = "manufacturer" | "exact_mpn" | "package_variant" | "symbol" | "footprint" | "pin_to_pad_mapping" | "stock" | "pricing";

export const MISSING_FACT_CLASS_LABEL: Readonly<Record<MissingFactClass, string>> = Object.freeze({
  identity: "Identity",
  evidence: "Evidence",
  stock_pricing: "Stock and pricing",
});

/** The pcb_assignable profile's needs, in import-review.ts's words (gate-tested equal to `importReviewProfileNeeds("pcb_assignable")`). */
export const EVIDENCE_NEEDS = Object.freeze(["symbol", "footprint", "pin-to-pad mapping"] as const);

/** The one sentence every stock/pricing fact carries (F.2, F.3; source-registry.ts). */
export const SOURCING_NEVER_PROVES = `a sourcing observation - never proof of ${ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING.join(", ")}`;
/** F.5, worded for the row. */
export const THEORY_NOT_PHYSICAL = "not a physical part: a Theory symbol names no manufacturer part, package or pins";

export interface MissingFact {
  id: MissingFactId;
  cls: MissingFactClass;
  label: string;
  state: MissingFactState;
  /** The value when known (a conflicting fact keeps the record's value); null otherwise. */
  value: string | null;
  /** Where the state came from (the record, the published revision, the sourcing observation, or why nothing did). */
  source: string;
  note: string | null;
}

/** What the schematic instance itself says. */
export interface SchematicInstanceFacts {
  /** The instance's display value ("10k", "NE555DR"), or null. */
  value: string | null;
  /** The catalog part id a KiCad instance was placed from; null for a Theory component. */
  partId: string | null;
  atomicPartRevisionId: string | null;
  symbolAssetVersionId: string | null;
  /** A Theory component's primitive type ("resistor"); null for a KiCad instance. */
  theoryType: string | null;
}

/** The catalog part record (CachedPart or CatalogPartDetail), projected to what the checklist reads. */
export interface CatalogPartFacts {
  id: string;
  name: string;
  mpn: string | null;
  manufacturer: string | null;
  libraryName: string;
  footprintHint: string | null;
  /** The record's normalized package (the route detail has it; the browser cache does not). */
  packageNormalized?: string | null;
  pinCount: number;
  hasSymbol: boolean;
  atomicAssignments?: Readonly<Record<string, { revisionId: string; symbolVersionId: string; footprintVersionId: string; mappingCertificateId: string; footprintFullName: string }>>;
  withdrawnValueKeys?: readonly string[];
}

export type CatalogPartLoad =
  | { state: "loaded"; part: CatalogPartFacts }
  | { state: "loading" }
  | { state: "unavailable"; reason: string }
  /** A Theory component has no catalog part. */
  | { state: "none" };

/** One external-search hit, projected (ExternalCandidateHit): sourcing only. */
export interface SourcingObservationFacts {
  sourceDisplayName: string;
  mpn: string;
  exactMatch: boolean;
  manufacturer: string | null;
  stock: number | null;
  priceBreaks: number;
  servedFrom: "live" | "process-memo";
}

export interface MissingFactsInput {
  instance: UnresolvedInstance;
  schematic: SchematicInstanceFacts;
  catalog: CatalogPartLoad;
  /** Sourcing observations already read for this part (optional; they never flip identity or evidence to known). */
  sourcing?: readonly SourcingObservationFacts[];
  /** A project is open (the distributor search and the publication request are a member's acts in a project). */
  projectOpen: boolean;
}

export type MissingPartActionId = "search_catalog" | "search_distributors" | "request_review" | "create_draft";

export type MissingPartActionAvailability =
  | { state: "available"; query: string | null; mode: "exact" | "keyword" | null }
  | { state: "not_available"; reason: string };

export interface MissingPartAction {
  id: MissingPartActionId;
  /** F's order: 1 catalog, 2 distributors, 3 review, 4 draft. */
  order: 1 | 2 | 3 | 4;
  label: string;
  /** The EXISTING route or component the action reuses (never a new authority). */
  route: string;
  availability: MissingPartActionAvailability;
  /** What the action can and cannot do, said beside the control. */
  note: string;
}

/** The prefill the publication request form takes (AtomicPublicationPrefill's fields, computed here without React). */
export interface PublicationPrefill {
  exactMpn: string | null;
  manufacturer: string | null;
  partId: string | null;
  symbol: { library: string; name: string } | null;
  footprint: { library: string; name: string } | null;
}

export interface MissingFactsChecklist {
  schema: typeof MISSING_FACTS_SCHEMA;
  refDes: string;
  family: UnresolvedInstance["family"];
  missing: UnresolvedInstanceMissing;
  /** false for a Theory symbol (F.5). */
  physical: boolean;
  /** One sentence over the row. */
  headline: string;
  facts: MissingFact[];
  actions: MissingPartAction[];
  /** The publication request's prefill (the review and the draft actions); null when neither is available. */
  publicationPrefill: PublicationPrefill | null;
  sourcingRule: typeof SOURCING_NEVER_PROVES;
}

export const MISSING_PART_ACTION_ROUTES: Readonly<Record<MissingPartActionId, string>> = Object.freeze({
  search_catalog: "POST /api/parts/search (the Build Library's catalog read) + GET /api/parts/[id] (the hit's published exact revision)",
  search_distributors: "POST /api/parts/external-search (the Build Library's Search distributors)",
  request_review: `POST ${ATOMIC_PUBLICATION_ROUTE} submit_request (AtomicPublicationReviewSection: a human requests, a reviewer approves, a different administrator publishes)`,
  create_draft: `POST ${ATOMIC_PUBLICATION_ROUTE} submit_request with the symbol/footprint references and profile pcb_assignable (the server assembles the UNVERIFIED draft; a pending request)`,
});

export const MISSING_PART_ACTION_LABELS: Readonly<Record<MissingPartActionId, string>> = Object.freeze({
  search_catalog: "Search catalog",
  search_distributors: "Search distributors",
  request_review: "Request review",
  create_draft: "Create unverified draft",
});

const ACTION_NOTES: Readonly<Record<MissingPartActionId, string>> = Object.freeze({
  search_catalog: "published local atomic revisions first: a hit with a published exact revision is placed from the Build Library (Use published exact revision)",
  search_distributors: "admitted sources only, at most 5 labelled sourcing observations each; an unavailable, paused or refused source shows that state - never a fake result, nothing is bought or bound",
  request_review: "a person requests the evidence review of the exact MPN; a reviewer approves and a different administrator publishes - no model and no search result can",
  create_draft: "explicitly UNVERIFIED: the request names the symbol and footprint by reference and the server assembles the draft; it is NOT PCB-assignable until the deterministic mapping checks and the human approval and publication pass",
});

const norm = (text: string | null | undefined): string => (text ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g, "");

/** The external-search query bound (the contract's: 1..64 printable ASCII characters; µ → u and Ω → ohm as value-key.ts spells them), or null when nothing searchable is left. */
export function boundedExternalQuery(text: string | null | undefined): string | null {
  if (!text) return null;
  const ascii = text.normalize("NFKC").replace(/[µμ]/g, "u").replace(/[Ωω]/g, "ohm").replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim().slice(0, EXTERNAL_SEARCH_MAX_QUERY_LENGTH).trim();
  return ascii.length > 0 ? ascii : null;
}

/** A source's state in words (BuildLibraryPanel's vocabulary): what it answered, when a paused source may be retried, or why it was not asked. */
export function externalSourceStateWords(source: ExternalSearchSourceStatus): string {
  switch (source.status) {
    case "available":
      return source.servedFrom ? `${SERVED_FROM_WORDS[source.servedFrom]} · ${source.hitCount} found${source.withheldHits > 0 ? ` · ${source.withheldHits} withheld` : ""}` : "not searched";
    case "paused":
      return source.retryAt === null ? "paused" : `paused until ${utcMinute(source.retryAt)}`;
    case "failed":
      return "search failed";
    case "not_searchable":
      return "no candidate search";
    case "disabled":
      return `disabled${source.ownerDecision ? ` (${source.ownerDecision})` : ""}`;
    case "blocked":
      return "blocked";
    case "operator_disabled":
      return "switched off by the operator";
    case "credentials_missing":
      return "not configured";
  }
}

/** True when the source answered nothing live: refused, paused, failed or not asked (no vendor was called for it). */
export function externalSourceAnsweredNothingLive(source: ExternalSearchSourceStatus): boolean {
  return !(source.status === "available" && source.servedFrom === "live");
}

/** "Library:Name" → the footprint reference the publication request form takes; null for anything else. */
export function footprintReferenceOf(hint: string | null | undefined): { library: string; name: string } | null {
  if (!hint) return null;
  const index = hint.indexOf(":");
  if (index <= 0 || index === hint.length - 1) return null;
  return { library: hint.slice(0, index).trim(), name: hint.slice(index + 1).trim() };
}

const fact = (id: MissingFactId, cls: MissingFactClass, label: string, state: MissingFactState, value: string | null, source: string, note: string | null = null): MissingFact => ({ id, cls, label, state, value, source, note });

/** The published assignment the instance's value selects: its own value key, then the '' default; null when neither is linked or the key's link was withdrawn. */
export function publishedAssignmentFor(part: CatalogPartFacts, value: string | null): { key: string; assignment: NonNullable<CatalogPartFacts["atomicAssignments"]>[string] } | { key: string; withdrawn: true } | null {
  const key = normalizeValueKey(value);
  const withdrawn = new Set(part.withdrawnValueKeys ?? []);
  const own = part.atomicAssignments?.[key];
  if (own) return { key, assignment: own };
  if (withdrawn.has(key)) return { key, withdrawn: true };
  const fallback = part.atomicAssignments?.[""];
  if (fallback) return { key: "", assignment: fallback };
  if (withdrawn.has("")) return { key: "", withdrawn: true };
  return null;
}

export function deriveMissingFacts(input: MissingFactsInput): MissingFactsChecklist {
  const { instance, schematic, catalog } = input;
  const sourcing = input.sourcing ?? [];
  const physical = instance.family !== "theory";
  const facts: MissingFact[] = [];
  const part = catalog.state === "loaded" ? catalog.part : null;
  const recordSource = part ? `catalog part record ${part.id} (${part.libraryName})` : null;
  const noRecord = catalog.state === "loading" ? "catalog part not loaded yet" : catalog.state === "unavailable" ? `catalog part unavailable: ${catalog.reason}` : catalog.state === "none" ? THEORY_NOT_PHYSICAL : "no catalog part record";

  // ── identity: the record; a distributor's spelling is a hint that may conflict, never a proof ─────────────────────────
  const hintManufacturers = [...new Set(sourcing.map((hit) => hit.manufacturer).filter((name): name is string => Boolean(name)))];
  const hintMpns = [...new Set(sourcing.map((hit) => hit.mpn))];
  const hintNote = (names: string[], what: string): string | null => (names.length > 0 ? `distributor ${what} ${names.map((name) => `"${name}"`).join(", ")}: an identity hint, not proof` : null);
  if (!physical) {
    facts.push(fact("manufacturer", "identity", "manufacturer", "unknown", null, THEORY_NOT_PHYSICAL, hintNote(hintManufacturers, "spelling")));
    facts.push(fact("exact_mpn", "identity", "exact MPN", "unknown", null, THEORY_NOT_PHYSICAL, hintNote(hintMpns, "MPN")));
    facts.push(fact("package_variant", "identity", "package variant", "unknown", null, THEORY_NOT_PHYSICAL));
  } else if (!part) {
    facts.push(fact("manufacturer", "identity", "manufacturer", "unknown", null, noRecord, hintNote(hintManufacturers, "spelling")));
    facts.push(fact("exact_mpn", "identity", "exact MPN", "unknown", null, noRecord, hintNote(hintMpns, "MPN")));
    facts.push(fact("package_variant", "identity", "package variant", "unknown", null, noRecord));
  } else {
    const manufacturerConflict = part.manufacturer ? hintManufacturers.filter((name) => norm(name) !== norm(part.manufacturer)) : [];
    facts.push(part.manufacturer
      ? fact("manufacturer", "identity", "manufacturer", manufacturerConflict.length > 0 ? "conflicting" : "known", part.manufacturer, recordSource!, manufacturerConflict.length > 0 ? `${hintNote(manufacturerConflict, "spelling")}; the record's name stands until a reviewer resolves it` : null)
      : fact("manufacturer", "identity", "manufacturer", "unknown", null, `${recordSource} names no manufacturer`, hintNote(hintManufacturers, "spelling")));
    const mpnConflict = part.mpn ? hintMpns.filter((mpn) => norm(mpn) !== norm(part.mpn)) : [];
    facts.push(part.mpn
      ? fact("exact_mpn", "identity", "exact MPN", mpnConflict.length > 0 ? "conflicting" : "known", part.mpn, recordSource!, mpnConflict.length > 0 ? `${hintNote(mpnConflict, "MPN")}; exactness is the reviewer's call` : null)
      : fact("exact_mpn", "identity", "exact MPN", "unknown", null, `${recordSource} names no MPN`, hintNote(hintMpns, "MPN")));
    facts.push(part.packageNormalized
      ? fact("package_variant", "identity", "package variant", "known", part.packageNormalized, `${recordSource} (a record claim; the footprint is evidence, below)`)
      : fact("package_variant", "identity", "package variant", "unknown", null, `${recordSource} names no package variant`, part.footprintHint ? `footprint hint "${part.footprintHint}" is a library hint, never package proof` : null));
  }

  // ── evidence: only a published, never withdrawn revision linked to the value ──────────────────────────────────────────
  const published = part ? publishedAssignmentFor(part, schematic.value) : null;
  const assignment = published && "assignment" in published ? published.assignment : null;
  const withdrawnLink = published && "withdrawn" in published;
  const revisionSource = assignment ? `published atomic revision ${assignment.revisionId}${published!.key === "" ? " (the part's default link)" : ` (value "${schematic.value ?? ""}")`}` : null;
  const noEvidence = !physical ? THEORY_NOT_PHYSICAL : !part ? noRecord : withdrawnLink ? `the record's link for this value points at a withdrawn or missing revision (value key "${published!.key}")` : "no published atomic revision links this catalog part";
  const [symbolLabel, footprintLabel, mappingLabel] = EVIDENCE_NEEDS;
  if (instance.missing === "symbol_asset") {
    // the revision exists on the instance; its symbol asset is not installed on it - the fix is a re-place, not a review
    facts.push(fact("symbol", "evidence", symbolLabel, "unknown", null, `published revision ${schematic.atomicPartRevisionId ?? "?"} without its installed symbol asset on this instance`, "re-place the part from its published revision"));
  } else if (assignment) {
    facts.push(fact("symbol", "evidence", symbolLabel, "known", assignment.symbolVersionId, revisionSource!));
  } else {
    facts.push(fact("symbol", "evidence", symbolLabel, "unknown", null, noEvidence, part?.hasSymbol ? `the KiCad library symbol of ${part.name} is a drawing, not a published symbol asset` : null));
  }
  facts.push(assignment
    ? fact("footprint", "evidence", footprintLabel, "known", assignment.footprintFullName || assignment.footprintVersionId, revisionSource!)
    : fact("footprint", "evidence", footprintLabel, "unknown", null, noEvidence, part?.footprintHint ? `footprint hint "${part.footprintHint}" is a library hint, never footprint evidence` : null));
  facts.push(assignment
    ? fact("pin_to_pad_mapping", "evidence", mappingLabel, "known", assignment.mappingCertificateId, revisionSource!)
    : fact("pin_to_pad_mapping", "evidence", mappingLabel, "unknown", null, noEvidence, part && part.pinCount > 0 ? `${part.pinCount} symbol pins is a pin count, never a pin-to-pad mapping` : null));

  // ── stock and pricing: sourcing observations, labelled; never identity or evidence ───────────────────────────────────
  const stocked = sourcing.filter((hit) => hit.stock !== null);
  const priced = sourcing.filter((hit) => hit.priceBreaks > 0);
  const sourcingLabel = (hits: readonly SourcingObservationFacts[]): string => `${[...new Set(hits.map((hit) => hit.sourceDisplayName))].join(", ")} · ${SOURCING_NEVER_PROVES}`;
  facts.push(stocked.length > 0
    ? fact("stock", "stock_pricing", "stock", "known", stocked.map((hit) => `${hit.sourceDisplayName}: ${hit.stock} (${hit.mpn}${hit.exactMatch ? "" : ", not an exact match"}, ${SERVED_FROM_WORDS[hit.servedFrom]})`).join("; "), sourcingLabel(stocked))
    : fact("stock", "stock_pricing", "stock", "unknown", null, sourcing.length > 0 ? `${sourcingLabel(sourcing)}: no stock figure` : "no sourcing observation read yet (Search distributors)", SOURCING_NEVER_PROVES));
  facts.push(priced.length > 0
    ? fact("pricing", "stock_pricing", "pricing", "known", priced.map((hit) => `${hit.sourceDisplayName}: ${hit.priceBreaks} price break${hit.priceBreaks === 1 ? "" : "s"} (${hit.mpn})`).join("; "), sourcingLabel(priced))
    : fact("pricing", "stock_pricing", "pricing", "unknown", null, sourcing.length > 0 ? `${sourcingLabel(sourcing)}: no price break` : "no sourcing observation read yet (Search distributors)", SOURCING_NEVER_PROVES));

  // ── next actions, in F's order ───────────────────────────────────────────────────────────────────────────────────────
  const mpn = part?.mpn ?? null;
  const catalogQuery = (mpn ?? part?.name ?? (schematic.theoryType ? `${schematic.theoryType} ${schematic.value ?? ""}` : schematic.value ?? "")).trim() || null;
  const search_catalog: MissingPartAction = {
    id: "search_catalog", order: 1, label: MISSING_PART_ACTION_LABELS.search_catalog, route: MISSING_PART_ACTION_ROUTES.search_catalog, note: ACTION_NOTES.search_catalog,
    availability: catalogQuery ? { state: "available", query: catalogQuery, mode: null } : { state: "not_available", reason: "nothing to search by: the instance names no MPN, part name or value" },
  };
  const externalQuery = boundedExternalQuery(mpn ?? (schematic.theoryType ? `${schematic.theoryType} ${schematic.value ?? ""}` : part?.name ?? schematic.value));
  const search_distributors: MissingPartAction = {
    id: "search_distributors", order: 2, label: MISSING_PART_ACTION_LABELS.search_distributors, route: MISSING_PART_ACTION_ROUTES.search_distributors, note: ACTION_NOTES.search_distributors,
    availability: !input.projectOpen
      ? { state: "not_available", reason: "open a project: the distributor search is a member's read of that project" }
      : externalQuery === null
        ? { state: "not_available", reason: `nothing to search by: no MPN, name or value fits a ${EXTERNAL_SEARCH_MAX_QUERY_LENGTH}-character printable query` }
        : { state: "available", query: externalQuery, mode: mpn ? "exact" : "keyword" },
  };
  const prefill: PublicationPrefill | null = part
    ? { exactMpn: mpn, manufacturer: part.manufacturer, partId: part.id, symbol: part.hasSymbol ? { library: part.libraryName, name: part.name } : null, footprint: footprintReferenceOf(part.footprintHint) }
    : physical ? null : { exactMpn: null, manufacturer: null, partId: null, symbol: null, footprint: null };
  const reviewBlocked = !input.projectOpen
    ? "open a project: a publication request is a member's act in a project (the server decides the governance project and the roles)"
    : instance.missing === "symbol_asset"
      ? "a published revision exists for this instance: re-place the part from it (no review is needed)"
      : assignment
        ? `a published exact revision exists for this part (${assignment.revisionId}): place it from the Build Library (Use published exact revision) instead of requesting a review`
        : null;
  const request_review: MissingPartAction = {
    id: "request_review", order: 3, label: MISSING_PART_ACTION_LABELS.request_review, route: MISSING_PART_ACTION_ROUTES.request_review, note: ACTION_NOTES.request_review,
    availability: reviewBlocked ? { state: "not_available", reason: reviewBlocked } : { state: "available", query: mpn, mode: null },
  };
  const draftBlocked = reviewBlocked
    ?? (!physical
      ? `${THEORY_NOT_PHYSICAL}: there are no documented dimensions or pins to draft from - place a catalog part first`
      : !part
        ? `no catalog part record to draft from (${noRecord})`
        : !mpn
          ? "no exact MPN: a draft is of one exact manufacturer part"
          : !part.hasSymbol
            ? "the catalog part has no symbol drawing to reference"
            : part.pinCount <= 0
              ? "the catalog part documents no pins: a draft without a pin table cannot be mapped"
              : null);
  const create_draft: MissingPartAction = {
    id: "create_draft", order: 4, label: MISSING_PART_ACTION_LABELS.create_draft, route: MISSING_PART_ACTION_ROUTES.create_draft, note: ACTION_NOTES.create_draft,
    availability: draftBlocked ? { state: "not_available", reason: draftBlocked } : { state: "available", query: mpn, mode: null },
  };

  const headline = !physical
    ? `${instance.refDes}: ${THEORY_NOT_PHYSICAL}`
    : instance.missing === "symbol_asset"
      ? `${instance.refDes}: published revision without its installed symbol asset - re-place the part from its published revision`
      : assignment
        ? `${instance.refDes}: a published exact revision exists for this part - place it from the Build Library (Use published exact revision)`
        : `${instance.refDes}: no published exact revision - ${facts.filter((item) => item.cls !== "stock_pricing" && item.state !== "known").length} of ${facts.filter((item) => item.cls !== "stock_pricing").length} identity and evidence facts unknown or conflicting`;

  return {
    schema: MISSING_FACTS_SCHEMA,
    refDes: instance.refDes,
    family: instance.family,
    missing: instance.missing,
    physical,
    headline,
    facts,
    actions: [search_catalog, search_distributors, request_review, create_draft],
    publicationPrefill: request_review.availability.state === "available" || create_draft.availability.state === "available" ? prefill : null,
    sourcingRule: SOURCING_NEVER_PROVES,
  };
}

/** The journey strip's stage sentence and the sidebar line share this wording. */
export function missingPartsWords(count: number): string {
  return `${count} missing part${count === 1 ? "" : "s"}`;
}
