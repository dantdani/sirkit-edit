/**
 * [PR-M, 2026-10-17] Section M.2.2: CANDIDATE SEARCH BY REQUIREMENTS over the local catalog, not a lookup of ids the model already
 * knows. The one composition behind `sirkit.parts.candidate-search` and the resolution proposal's own candidate reading.
 *
 *  1. RECALL: the Build loop's own hybrid catalog search (the `CatalogSearchPort` the chat route binds - app/lib/parts-search.ts
 *     behind it, with the catalog's real category vocabulary) for the stated role / specifications / package text. When an
 *     instance is named, its OWN catalog part is considered first: binding the exact published revision it already links for its
 *     value repairs the missing asset without changing the part (M.1: never replace a valid part unnecessarily).
 *  2. EXACT REVISIONS: each recalled part is re-read through the catalog port (`loadCatalogPartDetail`): the published exact
 *     revision it links for the instance's value (its own value key, else the value-agnostic default, never past a withdrawn key -
 *     `valueKeyLink`'s rule), then that revision's published evidence and catalog status through the revision evidence port.
 *  3. BUCKETS: every candidate lands in exactly one - `eligible` (published, selectable, symbol + footprint + approved mapping, and
 *     compatible with the instance by `evaluateCompatibility`), `draft` (a linked revision the catalog does not report as published),
 *     `missing-asset` (no published exact revision for the value - the legacy draft bridge every part carries is never approval - or a
 *     published one without its footprint / approved mapping / readable snapshot), `withdrawn`, `incompatible` and `unresolved` (the evidence cannot decide) - each with its reasons.
 *     Without an instance, compatibility is not evaluated and a complete published revision is listed as `unresolved` with that
 *     reason: availability of assets is not suitability.
 *
 * A search hit is a candidate, never authority, and a sourcing price or stock observation is not a CAD asset: no distributor is
 * called here and nothing is placed, bound, published or bought.
 */
import type { KicadPin } from "../kicad/types";
import type { CatalogPartDetail } from "../atomic/catalog-part-detail";
import type { AtomicRevisionStatus } from "../atomic/revision-status";
import { normalizeValueKey } from "../atomic/value-key";
import type { CatalogPartInspectionPort, CatalogPartInspectionPortAnswer } from "../agent/catalog-inspection-reads";
import { evaluateCompatibility, type CandidateRevisionFacts, type CompatibilityResult, type CurrentInstanceFacts, type ResolutionRequirement } from "./compatibility";
import type { CatalogSearchPort, CatalogSearchPortAnswer, PublishedRevisionEvidence, ResolutionPortScope, RevisionEvidencePort, RevisionEvidencePortAnswer } from "./evidence";
import { functionalClassOf, type FunctionalClass } from "./pin-functions";
import type { SchematicInstanceFacts } from "./instance-facts";

export const CANDIDATE_SEARCH_SCHEMA = "sirkit.resolution-candidate-search.v1" as const;
export const MAX_CANDIDATE_SEARCH_HITS = 10;
export const CANDIDATE_BUCKETS = Object.freeze(["eligible", "draft", "missing-asset", "withdrawn", "incompatible", "unresolved"] as const);
export type CandidateBucket = (typeof CANDIDATE_BUCKETS)[number];
/** The one sentence every search result carries about sourcing (the F.2 rule, worded for candidates). */
export const CANDIDATE_SOURCING_RULE = "a search hit is a candidate, never authority; a distributor price or stock observation is not a CAD asset and was not consulted" as const;

export interface CandidateEntry {
  catalogPartId: string;
  name: string;
  mpn: string | null;
  library: string;
  mainCategory: string;
  functionalClass: FunctionalClass;
  /** "own-part": the instance's own catalog part (binding needs no part change); "search": recalled by the query. */
  origin: "own-part" | "search";
  similarity: number | null;
  exactRevision: { revisionId: string; valueKey: string; symbolVersionId: string; footprintVersionId: string; mappingCertificateId: string; footprintFullName: string } | null;
  exactPart: { exactMpn: string; manufacturerName: string | null } | null;
  bucket: CandidateBucket;
  verdict: CompatibilityResult["verdict"] | "not_evaluated";
  reasons: Array<{ code: string; detail: string }>;
  warnings: string[];
  mapping: CompatibilityResult["mapping"];
  permutation: boolean;
  equivalence: CompatibilityResult["equivalence"];
}

export interface CandidateSearchReport {
  schema: typeof CANDIDATE_SEARCH_SCHEMA;
  query: string;
  category: { requested: string | null; status: string | null; applied: string | null; note: string | null };
  ranking: string;
  instance: { componentId: string; refDes: string; value: string; functionalClass: FunctionalClass } | null;
  requirement: ResolutionRequirement;
  buckets: Record<CandidateBucket, CandidateEntry[]>;
  counts: Record<CandidateBucket, number>;
  searched: { hits: number; partsRead: number; partsFailed: number; revisionsRead: number };
  sourcingRule: typeof CANDIDATE_SOURCING_RULE;
  note: string;
}

/** The instance side of the compatibility proof, from the instance inspection (server catalog pins + the sheet's nets). */
export function currentInstanceFactsOf(instance: SchematicInstanceFacts): CurrentInstanceFacts | null {
  if (instance.family !== "kicad" || !instance.partId) return null;
  return {
    componentId: instance.componentId,
    refDes: instance.refDes,
    partId: instance.partId,
    value: instance.value,
    functionalClass: instance.functionalClass,
    pins: instance.pins.source === "catalog-symbol" ? instance.pins.items.map((pin) => ({ number: pin.number, name: pin.name, electricalType: pin.electricalType, function: pin.function, netName: pin.net?.name ?? null })) : [],
    footprintHint: instance.catalog.part?.footprintHint ?? null,
  };
}

/** The published link a candidate part offers for a schematic value (the `valueKeyLink` rule) - or why it offers none. */
export function candidateLinkFor(detail: CatalogPartDetail, value: string): { kind: "link"; valueKey: string; link: NonNullable<CatalogPartDetail["atomicAssignments"]>[string] } | { kind: "withdrawn"; valueKey: string } | { kind: "none"; valueKey: string } {
  const key = normalizeValueKey(value);
  const links = detail.atomicAssignments ?? {};
  const withdrawn = new Set(detail.withdrawnValueKeys ?? []);
  if (Object.hasOwn(links, key)) return { kind: "link", valueKey: key, link: links[key]! };
  if (withdrawn.has(key)) return { kind: "withdrawn", valueKey: key };
  if (Object.hasOwn(links, "")) return { kind: "link", valueKey: "", link: links[""]! };
  if (withdrawn.has("")) return { kind: "withdrawn", valueKey: "" };
  return { kind: "none", valueKey: key };
}

/** The candidate side of the compatibility proof, assembled from server catalog + published evidence only. */
export function candidateRevisionFactsOf(input: { detail: CatalogPartDetail; valueKey: string; link: NonNullable<CatalogPartDetail["atomicAssignments"]>[string]; status: AtomicRevisionStatus | null; evidence: PublishedRevisionEvidence | null }): CandidateRevisionFacts {
  const classification = functionalClassOf({ libraryName: input.detail.libraryName, name: input.detail.name, description: input.detail.description, keywords: input.detail.keywords, properties: input.detail.properties });
  return {
    catalogPartId: input.detail.id,
    valueKey: input.valueKey,
    link: { revisionId: input.link.revisionId, symbolVersionId: input.link.symbolVersionId, footprintVersionId: input.link.footprintVersionId, mappingCertificateId: input.link.mappingCertificateId, footprintFullName: input.link.footprintFullName },
    catalogPins: input.detail.pins as KicadPin[],
    catalogFunctionalClass: classification.functionalClass,
    catalogFunctionalClassEvidence: classification.evidence,
    status: input.status,
    evidence: input.evidence,
  };
}

class Deadline { readonly kind = "deadline"; }

/** Race a port call against the remaining budget and the caller's signal; a late, failed or thrown answer is null. */
export async function boundedPortCall<T>(work: (signal: AbortSignal, deadlineMs: number) => Promise<T>, budgetMs: number, signal?: AbortSignal): Promise<T | null> {
  if (budgetMs <= 0 || signal?.aborted) return null;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const running = Promise.resolve().then(() => work(controller.signal, budgetMs));
    running.catch(() => undefined); // a late rejection after the deadline is never unhandled
    const answer = await Promise.race<T | Deadline>([running, new Promise<Deadline>((resolve) => { timer = setTimeout(() => { resolve(new Deadline()); controller.abort(); }, budgetMs); })]);
    return answer instanceof Deadline ? null : answer;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export interface CandidateSearchPorts {
  search: CatalogSearchPort;
  catalog: CatalogPartInspectionPort;
  evidence: RevisionEvidencePort;
}

export interface CandidateSearchInput {
  query: string;
  category: string | null;
  limit: number;
  instance: SchematicInstanceFacts | null;
  requirement: ResolutionRequirement;
  ports: CandidateSearchPorts;
  scope: ResolutionPortScope;
  runId: string;
  /** The whole call's remaining budget (ms); every port call is bounded by what is left. */
  budgetMs: number;
  signal?: AbortSignal;
  now?: () => number;
}

export type CandidateSearchOutcome = { ok: true; report: CandidateSearchReport } | { ok: false; code: "search_failed" | "search_timeout" | "evidence_failed"; detail: string };

/** Search, read and classify. Async over the injected ports only; deterministic over their answers. */
export async function searchResolutionCandidates(input: CandidateSearchInput): Promise<CandidateSearchOutcome> {
  const now = input.now ?? (() => Date.now());
  const started = now();
  const remaining = (): number => input.budgetMs - (now() - started);
  const limit = Math.max(1, Math.min(MAX_CANDIDATE_SEARCH_HITS, Math.floor(input.limit)));
  const searched = await boundedPortCall<CatalogSearchPortAnswer>((signal, deadlineMs) => input.ports.search.search({ query: input.query, category: input.category, limit, scope: input.scope, runId: input.runId, deadlineMs, signal }), Math.floor(remaining() * 0.6), input.signal);
  if (searched === null) return { ok: false, code: "search_timeout", detail: "The catalog search did not answer within the call's deadline; nothing was classified." };
  if (searched.state === "failed") return { ok: false, code: "search_failed", detail: `CATALOG_SEARCH_FAILED:${/^[A-Z][A-Z0-9_]{2,63}$/.test(searched.code) ? searched.code : "UNKNOWN"}` };

  // The part ids to read: the instance's own part first, then the recalled ones (deduplicated, bounded).
  const order: Array<{ partId: string; origin: "own-part" | "search"; similarity: number | null }> = [];
  if (input.instance?.partId) order.push({ partId: input.instance.partId, origin: "own-part", similarity: null });
  for (const hit of searched.hits.slice(0, limit)) if (!order.some((entry) => entry.partId === hit.partId)) order.push({ partId: hit.partId, origin: "search", similarity: hit.similarity });

  const details = new Map<string, { detail: CatalogPartDetail; status: Readonly<Record<string, AtomicRevisionStatus>> } | null>();
  let partsFailed = 0;
  for (const entry of order) {
    const answer = await boundedPortCall<CatalogPartInspectionPortAnswer>((signal, deadlineMs) => input.ports.catalog.inspect({ partId: entry.partId, scope: input.scope, runId: input.runId, deadlineMs, signal }), Math.min(5_000, Math.floor(remaining() * 0.5)), input.signal);
    if (answer?.state === "found") details.set(entry.partId, { detail: answer.detail, status: answer.revisionStatus });
    else { details.set(entry.partId, null); partsFailed += 1; }
  }
  const value = input.instance?.value ?? "";
  const revisionIds = [...new Set([...details.values()].flatMap((entry) => {
    if (!entry) return [];
    const link = candidateLinkFor(entry.detail, value);
    return link.kind === "link" ? [link.link.revisionId] : [];
  }))];
  let evidence: RevisionEvidencePortAnswer | null = { state: "ok", evidence: {}, status: {} };
  if (revisionIds.length > 0) {
    evidence = await boundedPortCall<RevisionEvidencePortAnswer>((signal, deadlineMs) => input.ports.evidence.load({ revisionIds, scope: input.scope, runId: input.runId, deadlineMs, signal }), Math.floor(remaining() * 0.8), input.signal);
    if (evidence === null || evidence.state === "failed") return { ok: false, code: "evidence_failed", detail: "The published revision evidence could not be read within the call's deadline; nothing was classified (a candidate is never eligible without its evidence)." };
  }
  const current: CurrentInstanceFacts | null = input.instance ? currentInstanceFactsOf(input.instance) : null;
  const buckets: Record<CandidateBucket, CandidateEntry[]> = { eligible: [], draft: [], "missing-asset": [], withdrawn: [], incompatible: [], unresolved: [] };
  for (const entry of order) {
    const read = details.get(entry.partId) ?? null;
    const base = (detail: CatalogPartDetail | null) => {
      const classification = detail ? functionalClassOf({ libraryName: detail.libraryName, name: detail.name, description: detail.description, keywords: detail.keywords, properties: detail.properties }) : { functionalClass: "unknown" as FunctionalClass };
      return { catalogPartId: entry.partId, name: detail?.name ?? "", mpn: detail?.mpn ?? null, library: detail?.libraryName ?? "", mainCategory: detail?.mainCategory ?? "", functionalClass: classification.functionalClass, origin: entry.origin, similarity: entry.similarity };
    };
    if (!read) {
      buckets.unresolved.push({ ...base(null), exactRevision: null, exactPart: null, bucket: "unresolved", verdict: "unresolved", reasons: [{ code: "catalog-read-failed", detail: "the catalog part could not be read; nothing about it is known" }], warnings: [], mapping: null, permutation: false, equivalence: null });
      continue;
    }
    const link = candidateLinkFor(read.detail, value);
    // a part of another functional class is incompatible whatever it publishes (the class is the first, decisive fact)
    const requiredClass = input.requirement.functionalClass ?? current?.functionalClass ?? "unknown";
    const candidateClass = base(read.detail).functionalClass;
    if (current && requiredClass !== "unknown" && candidateClass !== "unknown" && candidateClass !== requiredClass) {
      buckets.incompatible.push({ ...base(read.detail), exactRevision: link.kind === "link" ? { revisionId: link.link.revisionId, valueKey: link.valueKey, symbolVersionId: link.link.symbolVersionId, footprintVersionId: link.link.footprintVersionId, mappingCertificateId: link.link.mappingCertificateId, footprintFullName: link.link.footprintFullName } : null, exactPart: null, bucket: "incompatible", verdict: "incompatible", reasons: [{ code: "functional-class-mismatch", detail: `the candidate is a ${candidateClass}; the instance needs a ${requiredClass}` }], warnings: [], mapping: null, permutation: false, equivalence: null });
      continue;
    }
    if (link.kind === "withdrawn") {
      buckets.withdrawn.push({ ...base(read.detail), exactRevision: null, exactPart: null, bucket: "withdrawn", verdict: "incompatible", reasons: [{ code: "revision-withdrawn", detail: `the part's published revision for value key "${link.valueKey}" was withdrawn; it is never newly selected` }], warnings: [], mapping: null, permutation: false, equivalence: null });
      continue;
    }
    if (link.kind === "none") {
      // no published exact revision: the symbol, footprint and approved mapping were never published for this value (the catalog's
      // legacy draft bridge, `atomicCompatibility`, exists for every part and is never approval - it does not make this a draft)
      buckets["missing-asset"].push({ ...base(read.detail), exactRevision: null, exactPart: null, bucket: "missing-asset", verdict: "unresolved", reasons: [{ code: "asset-missing", detail: `no published exact revision (symbol + footprint + approved mapping) is linked for value key "${link.valueKey}"; the legacy draft bridge is never approval` }], warnings: [], mapping: null, permutation: false, equivalence: null });
      continue;
    }
    const answer = evidence as Extract<RevisionEvidencePortAnswer, { state: "ok" }>;
    const status = Object.hasOwn(answer.status, link.link.revisionId) ? answer.status[link.link.revisionId]! : (Object.hasOwn(read.status, link.link.revisionId) ? read.status[link.link.revisionId]! : null);
    const published = Object.hasOwn(answer.evidence, link.link.revisionId) ? answer.evidence[link.link.revisionId]! : null;
    const exactRevision = { revisionId: link.link.revisionId, valueKey: link.valueKey, symbolVersionId: link.link.symbolVersionId, footprintVersionId: link.link.footprintVersionId, mappingCertificateId: link.link.mappingCertificateId, footprintFullName: link.link.footprintFullName };
    const exactPart = published?.exactPart ? { exactMpn: published.exactPart.exactMpn, manufacturerName: published.exactPart.manufacturerName } : null;
    const candidate = candidateRevisionFactsOf({ detail: read.detail, valueKey: link.valueKey, link: link.link, status, evidence: published });
    if (!current) {
      // No instance: the assets are classified, compatibility is not.
      const verdict = evaluateCompatibility({ current: { componentId: "", refDes: "(no instance)", partId: "", value, functionalClass: input.requirement.functionalClass ?? candidate.catalogFunctionalClass, pins: [], footprintHint: null }, candidate, requirement: input.requirement });
      const bucket: CandidateBucket = verdict.bucket === "eligible" || verdict.reasons.some((reason) => reason.code === "current-pins-unavailable") ? "unresolved" : verdict.bucket;
      buckets[bucket].push({ ...base(read.detail), exactRevision, exactPart, bucket, verdict: "not_evaluated", reasons: bucket === "unresolved" ? [{ code: "no-instance", detail: "no instance was named, so the published assets were found but their suitability for a circuit was not evaluated" }] : verdict.reasons, warnings: [], mapping: null, permutation: false, equivalence: null });
      continue;
    }
    const verdict = evaluateCompatibility({ current, candidate, requirement: input.requirement });
    buckets[verdict.bucket].push({ ...base(read.detail), exactRevision, exactPart, bucket: verdict.bucket, verdict: verdict.verdict, reasons: verdict.reasons, warnings: verdict.warnings, mapping: verdict.mapping, permutation: verdict.permutation, equivalence: verdict.equivalence });
  }
  const counts = Object.fromEntries(CANDIDATE_BUCKETS.map((bucket) => [bucket, buckets[bucket].length])) as Record<CandidateBucket, number>;
  return {
    ok: true,
    report: {
      schema: CANDIDATE_SEARCH_SCHEMA,
      query: input.query,
      category: { requested: input.category, status: searched.category?.status ?? null, applied: searched.category?.applied ?? null, note: searched.category?.note ?? null },
      ranking: searched.ranking,
      instance: input.instance ? { componentId: input.instance.componentId, refDes: input.instance.refDes, value: input.instance.value, functionalClass: input.instance.functionalClass } : null,
      requirement: input.requirement,
      buckets,
      counts,
      searched: { hits: searched.hits.length, partsRead: order.length - partsFailed, partsFailed, revisionsRead: revisionIds.length },
      sourcingRule: CANDIDATE_SOURCING_RULE,
      note: counts.eligible > 0
        ? "Eligible candidates are published exact revisions with symbol, footprint and approved mapping that map every connected pin by function; propose one with the resolution proposal (a human reviews and applies it). A compatible result is not an electrical equivalence proof."
        : "No eligible local candidate: the buckets say why each candidate is not one. The next step is the missing-facts read and the unverified draft request (or an external source when one is bound); nothing was placed, bound or published.",
    },
  };
}
