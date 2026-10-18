/**
 * [PR-M, 2026-10-17] Section M.0 / M.2: the SERVER-OWNED facts the unresolved-component resolution is decided on, and the two
 * narrow ports the chat route injects for them. Nothing here comes from the request body, a browser pin list or the model:
 *
 *  - the CATALOG PART an instance was placed from (and every candidate part) is the shared catalog detail read
 *    (`loadCatalogPartDetail`, app/lib/atomic/catalog-part-detail.ts) the catalog inspection already reaches through its port
 *    (app/lib/agent/catalog-inspection-reads.ts `CatalogPartInspectionPort`): its KiCad symbol pins (number, name, electrical type,
 *    position), library, keywords, description and its published exact revision per value key;
 *  - the PUBLISHED EXACT REVISION of a candidate is its published portable snapshot (`loadSelectablePortableSnapshot`,
 *    app/lib/atomic/server-catalog.ts: published and never withdrawn) projected by `publishedRevisionEvidenceOf` below to the
 *    bounded facts the compatibility proof reads - the exact part, the published symbol's pins, the footprint's pads and mounting,
 *    the APPROVED mapping certificate's entries (symbol pin -> pad) and the revision's engineering claims - plus its catalog status
 *    (`loadAtomicRevisionStatus`). A withdrawn revision has no evidence (null) and its status says why;
 *  - the SEARCH over the local catalog is the Build loop's own hybrid recall (app/lib/parts-search.ts), reached only through
 *    `CatalogSearchPort`. A search hit is a CANDIDATE, never authority: every hit is re-read through the catalog and revision ports
 *    before it can be eligible. A sourcing price or stock observation is not a CAD asset and never appears here.
 *
 * Pure types and projections: no I/O, browser-safe.
 */
import type { KicadPin, KicadPinType } from "../kicad/types";
import type { AtomicRevisionStatus } from "../atomic/revision-status";
import type { CatalogPartDetail } from "../atomic/catalog-part-detail";
import type { ClaimState, LimitSemantics, MappingCertificateState, PortableAtomicSnapshot, QuantityDimension, TerminalClassification } from "../atomic/types";
import { engineeringDigest } from "../engineering/stable";

export const PUBLISHED_REVISION_EVIDENCE_SCHEMA = "sirkit.published-revision-evidence.v1" as const;
export const MAX_EVIDENCE_PINS = 256;
export const MAX_EVIDENCE_CLAIMS = 64;

export interface EvidencePin { id: string; number: string; name: string; electricalType: string; hidden: boolean }
export interface EvidencePad { number: string; electrical: boolean }
export interface EvidenceMappingEntry { symbolPinNumbers: string[]; padNumbers: string[]; classification: TerminalClassification }
export interface EvidenceQuantity { dimension: QuantityDimension; value?: number; min?: number; typical?: number; max?: number; unit: string }
export interface EvidenceClaim { property: string; facet: string; limit: LimitSemantics; state: ClaimState; quantity: EvidenceQuantity | null; text: string | null; evidenceCount: number }

/** The bounded evidence of ONE published exact revision (server-owned; the compatibility proof's target side). */
export interface PublishedRevisionEvidence {
  schema: typeof PUBLISHED_REVISION_EVIDENCE_SCHEMA;
  atomicPartRevisionId: string;
  exactPart: { exactMpn: string; manufacturerId: string; manufacturerName: string | null } | null;
  symbol: { versionId: string; symbolName: string; libraryNickname: string; pins: EvidencePin[] };
  /** The published symbol's pins in the planner's shape (positions included) - the same projection the B14 pin facts make. */
  plannerPins: KicadPin[];
  footprint: { versionId: string; footprintName: string; libraryNickname: string; mountingTechnology: "smd" | "through_hole" | "mixed" | "unknown"; pads: EvidencePad[] } | null;
  /** The primary bundle's mapping certificate, ONLY when it is the approved one the bundle names; null otherwise. */
  mapping: { id: string; state: MappingCertificateState; symbolVersionId: string; footprintVersionId: string; complete: boolean; entries: EvidenceMappingEntry[] } | null;
  claims: EvidenceClaim[];
  modelCount: number;
  /** Digest over everything above (the proposal seals it; the apply recompiles against fresh evidence and compares). */
  digest: string;
}

const KICAD_PIN_TYPES: ReadonlySet<string> = new Set([
  "input", "output", "bidirectional", "tri_state", "passive", "free", "unspecified",
  "power_in", "power_out", "open_collector", "open_emitter", "no_connect",
]);

const text = (value: unknown, max = 200): string => (typeof value === "string" ? Array.from(value).slice(0, max).join("") : "");

/** Project a published portable snapshot to the bounded evidence (null when it has no symbol or names no primary bundle). */
export function publishedRevisionEvidenceOf(snapshot: PortableAtomicSnapshot): PublishedRevisionEvidence | null {
  const revision = snapshot.atomicRevision;
  const bundle = revision?.cadBundles?.find((candidate) => candidate.disposition === "primary_approved") ?? revision?.cadBundles?.[0];
  const symbol = snapshot.symbol;
  if (!revision || !bundle || !symbol || symbol.versionId !== bundle.symbolVersionId || !Array.isArray(symbol.pins)) return null;
  const pins = symbol.pins.slice(0, MAX_EVIDENCE_PINS);
  const pinNumberById = new Map(pins.map((pin) => [pin.id, pin.number] as const));
  const footprint = snapshot.footprint && bundle.footprintVersionId && snapshot.footprint.versionId === bundle.footprintVersionId ? snapshot.footprint : null;
  const certificate = snapshot.mapping && bundle.mappingCertificateId && snapshot.mapping.id === bundle.mappingCertificateId && snapshot.mapping.state === "approved" ? snapshot.mapping : null;
  const padNumberById = new Map((footprint?.pads ?? []).map((pad) => [pad.id, pad.number] as const));
  const body: Omit<PublishedRevisionEvidence, "digest"> = {
    schema: PUBLISHED_REVISION_EVIDENCE_SCHEMA,
    atomicPartRevisionId: revision.id,
    exactPart: snapshot.exactPart ? { exactMpn: text(snapshot.exactPart.exactMpn), manufacturerId: text(snapshot.exactPart.manufacturerId), manufacturerName: snapshot.manufacturer ? text(snapshot.manufacturer.canonicalName) : null } : null,
    symbol: {
      versionId: symbol.versionId,
      symbolName: text(symbol.symbolName, 120),
      libraryNickname: text(symbol.origin?.libraryNickname, 120),
      pins: pins.map((pin) => ({ id: pin.id, number: text(pin.number, 32), name: text(pin.name, 64), electricalType: text(pin.electricalType, 32), hidden: pin.hidden === true })),
    },
    plannerPins: pins.map((pin) => ({
      number: pin.number,
      name: pin.name,
      type: (KICAD_PIN_TYPES.has(pin.electricalType) ? pin.electricalType : "unspecified") as KicadPinType,
      position: { x: pin.position.x, y: pin.position.y },
      orientation: pin.orientation,
      length: pin.length,
      ...(pin.unit !== undefined ? { unit: pin.unit } : {}),
      ...(pin.bodyStyle !== undefined ? { bodyStyle: pin.bodyStyle } : {}),
      ...(pin.hidden ? { hidden: true } : {}),
      ...(pin.stacked ? { stacked: true } : {}),
    })),
    footprint: footprint
      ? { versionId: footprint.versionId, footprintName: text(footprint.footprintName, 120), libraryNickname: text(footprint.origin?.libraryNickname, 120), mountingTechnology: footprint.mountingTechnology, pads: footprint.pads.slice(0, MAX_EVIDENCE_PINS).map((pad) => ({ number: text(pad.number, 32), electrical: !pad.mechanical })) }
      : null,
    mapping: certificate
      ? {
          id: certificate.id,
          state: certificate.state,
          symbolVersionId: certificate.symbolVersionId,
          footprintVersionId: certificate.footprintVersionId,
          complete: certificate.missingTerminalIds.length === 0 && certificate.missingSymbolPinIds.length === 0 && certificate.missingPadNumbers.length === 0 && certificate.ambiguous.length === 0,
          entries: certificate.entries.slice(0, MAX_EVIDENCE_PINS).map((entry) => ({
            symbolPinNumbers: entry.symbolPinIds.map((id) => pinNumberById.get(id) ?? `?${text(id, 40)}`),
            // logical pad numbers are the certificate's own vocabulary; a physical pad id is projected to its number when the footprint names it
            padNumbers: entry.logicalPadNumbers.length > 0 ? entry.logicalPadNumbers.map((pad) => text(pad, 32)) : entry.physicalPadIds.map((id) => padNumberById.get(id) ?? `?${text(id, 40)}`),
            classification: entry.classification,
          })),
        }
      : null,
    claims: (snapshot.claims ?? []).slice(0, MAX_EVIDENCE_CLAIMS).map((claim) => {
      const value = claim.value;
      const quantity: EvidenceQuantity | null = value !== null && typeof value === "object" && !Array.isArray(value) && "dimension" in value
        ? { dimension: value.dimension, ...(value.value !== undefined ? { value: value.value } : {}), ...(value.min !== undefined ? { min: value.min } : {}), ...(value.typical !== undefined ? { typical: value.typical } : {}), ...(value.max !== undefined ? { max: value.max } : {}), unit: text(value.sourceUnit, 16) }
        : null;
      return { property: text(claim.property, 64), facet: text(claim.facet, 64), limit: claim.limit, state: claim.state, quantity, text: quantity ? null : (typeof value === "string" ? text(value, 120) : value === null ? null : text(JSON.stringify(value), 120)), evidenceCount: claim.evidenceIds.length };
    }),
    modelCount: Array.isArray(snapshot.models) ? snapshot.models.length : 0,
  };
  return { ...body, digest: engineeringDigest({ schema: PUBLISHED_REVISION_EVIDENCE_SCHEMA, body }) };
}

/** Recompute an evidence record's digest (a structural copy that was altered after projection no longer matches). */
export function revisionEvidenceDigestMatches(evidence: PublishedRevisionEvidence): boolean {
  const { digest, ...body } = evidence;
  return digest === engineeringDigest({ schema: PUBLISHED_REVISION_EVIDENCE_SCHEMA, body });
}

// ─── The ports the chat route injects ───────────────────────────────────────────────────────────────────────────────────────

export interface ResolutionPortScope { readonly tenantId: string; readonly projectId: string; readonly branchId: string }

export interface RevisionEvidencePortRequest {
  readonly revisionIds: readonly string[];
  readonly scope: ResolutionPortScope;
  readonly runId: string;
  readonly deadlineMs: number;
  readonly signal: AbortSignal;
}
export type RevisionEvidencePortAnswer =
  | {
      readonly state: "ok";
      /** By revision id: the evidence of a published, never-withdrawn revision; null for a withdrawn, unpublished or unknown one. */
      readonly evidence: Readonly<Record<string, PublishedRevisionEvidence | null>>;
      /** By revision id: the catalog status of a published revision (absent: the id names no published revision). */
      readonly status: Readonly<Record<string, AtomicRevisionStatus>>;
    }
  | { readonly state: "failed"; readonly code: string };
/** The server port behind the published revision evidence (app/api/chat/component-resolution-runtime.ts); faked in tests. */
export interface RevisionEvidencePort {
  load(request: RevisionEvidencePortRequest): Promise<RevisionEvidencePortAnswer>;
}

export interface CatalogSearchPortRequest {
  readonly query: string;
  /** A category name or request (normalised by the search onto the catalog's own vocabulary; an unrecognised one filters nothing). */
  readonly category: string | null;
  readonly limit: number;
  readonly scope: ResolutionPortScope;
  readonly runId: string;
  readonly deadlineMs: number;
  readonly signal: AbortSignal;
}
export interface CatalogSearchHit { readonly partId: string; readonly name: string; readonly mpn: string | null; readonly mainCategory: string; readonly similarity: number; readonly pinCount: number }
export type CatalogSearchPortAnswer =
  | { readonly state: "ok"; readonly hits: readonly CatalogSearchHit[]; readonly category: { readonly status: string; readonly applied: string | null; readonly note: string | null } | null; readonly ranking: "reranked" | "fused" | "unknown" }
  | { readonly state: "failed"; readonly code: string };
/** The server port behind the local catalog search (the Build loop's own recall); faked in tests. */
export interface CatalogSearchPort {
  search(request: CatalogSearchPortRequest): Promise<CatalogSearchPortAnswer>;
  /** [PR-M, 2026-10-18] set ONLY by the fixture runtime's seam (app/api/chat/component-resolution-runtime.ts): its recall is a word-overlap
   *  match over the committed fixture catalog (no embedding, no reranker), and the candidate search says so in its output. */
  readonly recall?: "fixture-catalog";
}

/** The fresh server facts of one resolution apply: every catalog part the batch is decided on and the evidence + status of its
 *  asserted revisions (the shapes the proposal was assembled from; the apply's one-shot channel carries them). */
export interface FreshResolutionFacts {
  parts: Array<{ partId: string; detail: CatalogPartDetail | null; revisionStatus: Record<string, AtomicRevisionStatus> }>;
  evidence: Record<string, PublishedRevisionEvidence | null>;
  status: Record<string, AtomicRevisionStatus>;
}
