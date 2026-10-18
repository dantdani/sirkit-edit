/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3 item 6, design M2.4): the REVIEW HANDOFF - aggregate `atomic.acquisition-handoff.v1`, an
 * INBOX in the catalog GOVERNANCE scope (OD-37: `SIRKIT_ATOMIC_CATALOG_TENANT_ID` / `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`, default branch).
 *
 *  - It is created only by a HUMAN member action in the source project ("Send for component review"): an AI actor is refused here as at
 *    every publication step (OD-244 extended); the agent prepares the package, a person sends it.
 *  - It copies into the governance scope's object store ONLY objects whose raw, derived and export dispositions are all
 *    `redistributable` and whose retention is indefinite (stricter than validation.ts, which admits `private_review_only`, OD-M2-11).
 *  - It carries no project id and no design context: the requester principal, the requester's tenant, an opaque callback digest, and the
 *    catalog-level target (the catalog part, its KiCad symbol / footprint, the stated MPN / package / mounting). A requester of another
 *    tenant is refused (OD-M2-8). Unset governance ids refuse with GOVERNANCE_UNCONFIGURED (OD-M2-1).
 *  - The PACKAGE a person acts on: a prefilled `AtomicPublicationSpec` (references to the stored objects, the pin table or - without a
 *    permitted datasheet - the KiCad convention offered for confirmation), the validation report, each object's source / ref / locator /
 *    hash / licence / attribution, open conflicts and missing facts, and the proposed link (the instance's own catalog part when the link
 *    rule would pass) or the discovery-row option.
 *
 * The publication route reads acquired bytes through `acquiredAssetsLoader` / `handoffRegisteredCandidates` below - the store, never the
 * egress path (VENDOR_REACH stays clean for every publication module).
 */
import { durableAggregateIdentity, durableScopeKey } from "../../durable-workflow/stable";
import type { DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import { canonicalJson, sha256 } from "../../atomic/stable";
import { isHumanCatalogActorId } from "../../atomic/catalog";
import { canonicalExactMpn } from "../../atomic/identity";
import { terminalTableText, type AcquiredKicadAssets, type AcquiredPinTable, type KicadAssetText } from "../../atomic/authoring";
import type { AtomicPublicationLink, AtomicPublicationSpec } from "../../atomic/publication-review-contract";
import type { EngineeringActor, ProjectRole } from "../../engineering/types";
import { candidateFromExtraction, type NormalizedCandidate } from "../../acquisition/quarantine";
import { DurableAcquiredObjectStore, CadObjectStoreError, type AcquiredObject } from "../../acquisition/cad-object-store";
import { PIN_TABLE_PARSER_VERSION } from "../../acquisition/datasheet-pin-table";
import type { CadValidationReport } from "../../acquisition/cad-validation";
import { CAD_SOURCE_REGISTRY } from "../../acquisition/cad-source-registry";
import { DurableAcquisitionCandidateStore, type AcquisitionCandidate, type CandidateObjectRef } from "./candidate";
import { cadPinTableSourceIdentity, cadRevisionLabel, cadSourceIdentity } from "./source-identity";
import { normalizeValueKey } from "../../atomic/value-key";

export const ACQUISITION_HANDOFF_AGGREGATE = "atomic.acquisition-handoff.v1" as const;
export const ACQUISITION_HANDOFF_SCHEMA = "sirkit.acquisition-handoff.v1" as const;
export const HANDOFF_ID = /^acquisition-handoff:[0-9a-f]{32}$/;
/** The library a discovery row is written in: one per source library, so its category is the source library's (correction to M2.5's one `Sirkit_Acquired`). */
export const DISCOVERY_LIBRARY_PREFIX = "Sirkit_Acquired_" as const;
const HANDOFF_ROLES: ReadonlySet<ProjectRole> = new Set<ProjectRole>(["pcb_editor", "reviewer", "project_admin"]);
const PART_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AcquisitionHandoff {
  schema: typeof ACQUISITION_HANDOFF_SCHEMA;
  handoffId: string;
  createdAt: string;
  requester: { principalId: string; tenantId: string; membershipRevision: string | null };
  /** sha256 of the source scope and task id: the task finds its handoff, the inbox learns nothing about the project */
  callbackDigest: string;
  candidateId: string;
  reportDigest: string;
  sourceId: AcquisitionCandidate["sourceId"];
  fixtureEvidence: boolean;
  target: Pick<AcquisitionCandidate["target"], "catalogPartId" | "catalogMpn" | "symbol" | "footprint" | "exactMpn" | "packageCode" | "mounting"> & { valueKey: string };
  objects: CandidateObjectRef[];
  symbolObject: string;
  footprintObject: string | null;
  datasheetObject: string | null;
  pinTable: AcquisitionCandidate["pinTable"];
  report: CadValidationReport;
  licence: AcquisitionCandidate["licence"];
  package: {
    spec: AtomicPublicationSpec;
    links: AtomicPublicationLink[];
    /** write ONE catalog discovery row and its link in the publication transaction (when no own-part link is possible) */
    discovery: boolean;
    terminalOrigin: "datasheet" | "symbol-convention";
    missing: string[];
    conflicts: string[];
    notes: string[];
  };
}

export class AcquisitionHandoffError extends Error {
  constructor(readonly code: "ACQUISITION_HANDOFF_GOVERNANCE_UNCONFIGURED" | "ACQUISITION_HANDOFF_HUMAN_REQUIRED" | "ACQUISITION_HANDOFF_FORBIDDEN" | "ACQUISITION_HANDOFF_CROSS_TENANT" | "ACQUISITION_HANDOFF_NOT_READY" | "ACQUISITION_HANDOFF_LICENCE_REFUSED" | "ACQUISITION_HANDOFF_NOT_FOUND" | "ACQUISITION_HANDOFF_OBJECT_MISSING", detail: string = code) {
    super(detail);
    this.name = "AcquisitionHandoffError";
  }
}

export interface HandoffDeps {
  repository: DurableWorkflowRepository;
  /** the governance ids (OD-37): the environment's in normal mode, the fixture container's under the fixture runtime; null refuses */
  governance: { tenantId: string | null; projectId: string | null };
  clock?: () => number;
}

export function governanceScopeOf(governance: HandoffDeps["governance"]): DurableWorkflowScope | null {
  return governance.tenantId && governance.projectId ? { tenantId: governance.tenantId, projectId: governance.projectId, branchId: "main" } : null;
}

export function handoffCallbackDigest(scope: DurableWorkflowScope, taskId: string): string {
  return sha256(canonicalJson({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, taskId }));
}

function handoffIdOf(candidateId: string, callbackDigest: string): string {
  return `acquisition-handoff:${sha256(canonicalJson({ candidateId, callbackDigest })).slice(0, 32)}`;
}

const redistributable = (object: AcquiredObject): boolean => object.retention === "indefinite" && [object.license.rawRedistribution, object.license.derivedRedistribution, object.license.exportDisposition].every((item) => item === "redistributable");

/** The prefilled publication spec: references to the stored objects; the terminal table from the pin table, else the KiCad convention. */
function packageOf(candidate: AcquisitionCandidate, handoffId: string): AcquisitionHandoff["package"] {
  const target = candidate.target;
  const symbolPins = candidate.symbol?.pins ?? [];
  const terminals = candidate.pinTable
    ? candidate.pinTable.rows.map((row) => ({ number: row.number, function: row.function, pads: [...row.pads] }))
    : symbolPins.filter((pin) => pin.number).map((pin) => ({ number: pin.number, function: pin.name && pin.name !== "~" ? pin.name : pin.number, pads: [pin.number] }));
  const packageCode = target.packageCode ?? candidate.pinTable?.packageCode ?? null;
  const mounting = target.mounting ?? candidate.pinTable?.mounting ?? (candidate.footprint?.mountingTechnology === "smd" || candidate.footprint?.mountingTechnology === "through_hole" ? candidate.footprint.mountingTechnology : null);
  const exactMpn = target.exactMpn ?? target.catalogMpn ?? target.symbol.name;
  const spec: AtomicPublicationSpec = {
    exactMpn,
    profile: candidate.footprintObject ? "pcb_assignable" : "schematic_only",
    symbol: { library: target.symbol.library, name: target.symbol.name, acquired: { handoffId, objectHash: candidate.symbolObject! } },
    footprint: candidate.footprintObject && target.footprint ? { library: target.footprint.library, name: target.footprint.name, acquired: { handoffId, objectHash: candidate.footprintObject } } : null,
    terminals,
    package: packageCode && mounting ? { code: packageCode, mounting } : null,
    datasheet: null,
    manufacturer: null,
  };
  // the instance's own catalog part, when the link rule would pass (its MPN null or the exact MPN; the same library:name)
  let ownLink = false;
  try { ownLink = PART_UUID.test(target.catalogPartId) && (target.catalogMpn === null || canonicalExactMpn(target.catalogMpn) === canonicalExactMpn(exactMpn)) && spec.profile === "pcb_assignable"; } catch { ownLink = false; }
  const valueKey = target.catalogMpn ? "" : normalizeValueKey(target.value);
  const notes = [
    candidate.pinTable ? `terminal table: from ${candidate.pinTable.fixture ? "the FIXTURE pin table (not a manufacturer datasheet)" : "the source's pin table"} for ${candidate.pinTable.part}` : "terminal table: prefilled from the official KiCad symbol's pins by the KiCad convention (pin n = pad n) - confirm it against the datasheet you cite; submitting makes it your organization-authored entry",
    candidate.report.identity.kind === "generic" ? `identity: ${candidate.report.identity.basis} - enter the manufacturer you verified (and cite the datasheet)` : `identity: exact MPN ${candidate.report.identity.exactMpn} (${candidate.report.identity.basis})`,
    `assets: ${CAD_SOURCE_REGISTRY[candidate.sourceId].displayName}${candidate.fixtureEvidence ? " (FIXTURE evidence)" : ""}, licence ${candidate.licence.record.spdxId ?? candidate.licence.record.id}: ${candidate.licence.attribution}`,
    ownLink ? `publishing links catalog part ${target.catalogPartId} (value key "${valueKey}") to the revision` : "publishing writes one discovery catalog part for the revision (the instance's own part cannot take the link)",
  ];
  return { spec, links: ownLink ? [{ partId: target.catalogPartId.toLowerCase(), valueKey }] : [], discovery: !ownLink && spec.profile === "pcb_assignable", terminalOrigin: candidate.pinTable ? "datasheet" : "symbol-convention", missing: [...candidate.report.unresolved, ...candidate.missing], conflicts: [...candidate.report.conflicts], notes };
}

/**
 * Send a validated candidate for review: a human member of the source project, the governance scope configured and of the same tenant.
 * Idempotent: the same candidate and task again answers the same handoff.
 */
export async function createAcquisitionHandoff(deps: HandoffDeps, input: { sourceScope: DurableWorkflowScope; taskId: string; candidateId: string; actor: EngineeringActor; membershipRevision: string | null }): Promise<{ handoff: AcquisitionHandoff; created: boolean }> {
  const governance = governanceScopeOf(deps.governance);
  if (!governance) throw new AcquisitionHandoffError("ACQUISITION_HANDOFF_GOVERNANCE_UNCONFIGURED", "no catalog governance project is configured (OD-M2-1)");
  if (input.actor.actorKind !== "human" || !isHumanCatalogActorId(input.actor.actorId)) throw new AcquisitionHandoffError("ACQUISITION_HANDOFF_HUMAN_REQUIRED", "only a person sends a part for component review (the assistant prepares the package)");
  if (!HANDOFF_ROLES.has(input.actor.role)) throw new AcquisitionHandoffError("ACQUISITION_HANDOFF_FORBIDDEN", "an editor, reviewer or administrator sends a part for review");
  if (input.sourceScope.tenantId !== governance.tenantId) throw new AcquisitionHandoffError("ACQUISITION_HANDOFF_CROSS_TENANT", "a member of another tenant cannot hand a candidate to this governance inbox (OD-M2-8)");
  const candidates = new DurableAcquisitionCandidateStore(deps.repository);
  const candidate = await candidates.get(input.sourceScope, input.candidateId);
  if (candidate.state !== "validated" && candidate.state !== "handed-off") throw new AcquisitionHandoffError("ACQUISITION_HANDOFF_NOT_READY", `the candidate is ${candidate.state}: only a validated candidate is sent for review`);
  if (!candidate.symbolObject) throw new AcquisitionHandoffError("ACQUISITION_HANDOFF_NOT_READY", "the candidate has no stored symbol");
  const callbackDigest = handoffCallbackDigest(input.sourceScope, input.taskId);
  const handoffId = handoffIdOf(candidate.candidateId, callbackDigest);
  const identity = durableAggregateIdentity(governance, ACQUISITION_HANDOFF_AGGREGATE, handoffId);
  const existing = await deps.repository.loadHead<AcquisitionHandoff>(identity);
  if (existing) return { handoff: structuredClone(existing.payload), created: false };
  // copy every stored object the package names, licence and retention re-checked on the bytes' own record
  const objects = new DurableAcquiredObjectStore(deps.repository);
  const at = new Date((deps.clock ?? Date.now)()).toISOString();
  const wanted = [candidate.symbolObject, candidate.footprintObject, candidate.datasheetObject].filter((hash): hash is string => typeof hash === "string");
  for (const hash of wanted) {
    let object: AcquiredObject;
    try { object = await objects.get(input.sourceScope, hash); } catch (error) { throw new AcquisitionHandoffError("ACQUISITION_HANDOFF_OBJECT_MISSING", `a stored object is missing or failed its re-hash (${error instanceof CadObjectStoreError ? error.code : "unreadable"})`); }
    if (!redistributable(object)) throw new AcquisitionHandoffError("ACQUISITION_HANDOFF_LICENCE_REFUSED", `object ${hash.slice(0, 12)} is not redistributable with indefinite retention (OD-M2-11)`);
    for (const provenance of object.provenance) await objects.put(governance, { text: object.text, kind: object.kind, mediaType: object.mediaType, license: object.license, retention: object.retention, provenance, committedAt: at });
  }
  const handoff: AcquisitionHandoff = {
    schema: ACQUISITION_HANDOFF_SCHEMA, handoffId, createdAt: at,
    requester: { principalId: input.actor.actorId, tenantId: input.sourceScope.tenantId, membershipRevision: input.membershipRevision },
    callbackDigest, candidateId: candidate.candidateId, reportDigest: candidate.report.digest, sourceId: candidate.sourceId, fixtureEvidence: candidate.fixtureEvidence,
    target: { catalogPartId: candidate.target.catalogPartId, catalogMpn: candidate.target.catalogMpn, symbol: candidate.target.symbol, footprint: candidate.target.footprint, exactMpn: candidate.target.exactMpn, packageCode: candidate.target.packageCode, mounting: candidate.target.mounting, valueKey: candidate.target.catalogMpn ? "" : normalizeValueKey(candidate.target.value) },
    objects: candidate.objects.filter((object) => wanted.includes(object.sha256) || object.role === "symbol-file" || object.role === "symbol-parent"),
    symbolObject: candidate.symbolObject, footprintObject: candidate.footprintObject, datasheetObject: candidate.datasheetObject, pinTable: candidate.pinTable,
    report: candidate.report, licence: candidate.licence,
    package: packageOf(candidate, handoffId),
  };
  try {
    await deps.repository.commit({ scope: governance, scopeKey: durableScopeKey(governance, "acquisition-handoffs"), idempotencyKey: `acquisition-handoff:${handoffId}`, operations: [{ aggregateType: ACQUISITION_HANDOFF_AGGREGATE, aggregateKey: handoffId, expectedRevision: 0, payload: handoff }], outbox: [], result: { handoffId }, committedAt: at });
  } catch (error) {
    if (!(error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT")) throw error;
    const raced = await deps.repository.loadHead<AcquisitionHandoff>(identity);
    if (raced) return { handoff: structuredClone(raced.payload), created: false };
    throw error;
  }
  if (candidate.state === "validated") await candidates.transition(input.sourceScope, candidate.candidateId, "handed-off", { by: input.actor.actorId, note: `sent for component review as ${handoffId}`, at });
  return { handoff, created: true };
}

/** One handoff of the governance inbox (unknown, malformed and foreign ids are the same `null`). */
export async function loadAcquisitionHandoff(deps: HandoffDeps, handoffId: unknown): Promise<AcquisitionHandoff | null> {
  const governance = governanceScopeOf(deps.governance);
  if (!governance || typeof handoffId !== "string" || !HANDOFF_ID.test(handoffId)) return null;
  const head = await deps.repository.loadHead<AcquisitionHandoff>(durableAggregateIdentity(governance, ACQUISITION_HANDOFF_AGGREGATE, handoffId));
  return head && head.payload.schema === ACQUISITION_HANDOFF_SCHEMA && head.payload.handoffId === handoffId ? structuredClone(head.payload) : null;
}

/** The governance inbox (newest first). */
export async function listAcquisitionHandoffs(deps: HandoffDeps): Promise<AcquisitionHandoff[]> {
  const governance = governanceScopeOf(deps.governance);
  if (!governance) return [];
  const heads = await deps.repository.listHeads<AcquisitionHandoff>({ aggregateType: ACQUISITION_HANDOFF_AGGREGATE, scope: governance, limit: 1_000 });
  return heads.map((head) => structuredClone(head.payload)).filter((handoff) => handoff.schema === ACQUISITION_HANDOFF_SCHEMA).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.handoffId.localeCompare(b.handoffId));
}

/** The handoff a spec's acquired references name (both must name the same one), or null. */
export function specHandoffId(spec: AtomicPublicationSpec): string | null {
  const ids = [spec.symbol?.acquired?.handoffId, spec.footprint?.acquired?.handoffId].filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return null;
  return ids.every((id) => id === ids[0]) ? ids[0]! : null;
}

function assetText(handoff: AcquisitionHandoff, object: AcquiredObject, kind: "symbol" | "footprint"): KicadAssetText {
  const first = object.provenance.find((row) => row.sourceId !== "composed") ?? object.provenance[0]!;
  const original = handoff.objects.find((ref) => ref.role === (kind === "symbol" ? "symbol-file" : "footprint"));
  return {
    text: object.text,
    source: cadSourceIdentity(handoff.sourceId),
    license: object.license,
    revision: cadRevisionLabel(handoff.sourceId, kind),
    locator: first.sourceId === "composed" ? `${original?.locator ?? first.locator} (composed with its parent symbols)` : first.locator,
    retrievedAt: original?.retrievedAt ?? first.retrievedAt,
  };
}

/**
 * The publication route's ACQUIRED ASSET port: for a spec naming a handoff, its stored objects (governance scope, re-hashed) preloaded
 * into the synchronous reader the authoring uses, and its pin table. A spec that names objects the handoff does not hold reads null
 * (the review then shows the asset missing); a spec naming no handoff answers null.
 */
export function acquiredAssetsLoader(deps: HandoffDeps): (spec: AtomicPublicationSpec) => Promise<AcquiredKicadAssets | null> {
  return async (spec) => {
    const handoffId = specHandoffId(spec);
    if (!handoffId) return null;
    const handoff = await loadAcquisitionHandoff(deps, handoffId);
    const governance = governanceScopeOf(deps.governance);
    if (!handoff || !governance) return { read: () => null, pinTable: null };
    const objects = new DurableAcquiredObjectStore(deps.repository);
    const load = async (hash: string | null): Promise<AcquiredObject | null> => { if (!hash) return null; try { return await objects.get(governance, hash); } catch { return null; } };
    const symbol = spec.symbol?.acquired?.objectHash === handoff.symbolObject ? await load(handoff.symbolObject) : null;
    const footprint = spec.footprint?.acquired && spec.footprint.acquired.objectHash === handoff.footprintObject ? await load(handoff.footprintObject) : null;
    const datasheet = await load(handoff.datasheetObject);
    const pinTableSource = cadPinTableSourceIdentity(handoff.sourceId);
    const pinTable: AcquiredPinTable | null = datasheet && handoff.pinTable && pinTableSource ? {
      text: datasheet.text, source: pinTableSource, license: datasheet.license, revision: cadRevisionLabel(handoff.sourceId, "datasheet"), locator: datasheet.provenance[0]!.locator, retrievedAt: datasheet.provenance[0]!.retrievedAt,
      terminals: terminalTableText(handoff.pinTable.rows), parserVersion: PIN_TABLE_PARSER_VERSION,
    } : null;
    return {
      read: (kind, reference) => {
        const object = kind === "symbol" ? symbol : footprint;
        const named = kind === "symbol" ? handoff.target.symbol : handoff.target.footprint;
        if (!object || !named || reference.acquired.handoffId !== handoffId || reference.acquired.objectHash !== object.sha256 || reference.library !== named.library || reference.name !== named.name) return null;
        return assetText(handoff, object, kind);
      },
      pinTable,
    };
  };
}

/** The publication route's `registeredCandidates`: the handoff's pin table as an extraction candidate (its own source class, never manufacturer_datasheet for a fixture). */
export function handoffRegisteredCandidates(deps: HandoffDeps): (exactMpn: string, spec?: AtomicPublicationSpec) => Promise<readonly NormalizedCandidate[]> {
  const loader = acquiredAssetsLoader(deps);
  return async (exactMpn, spec) => {
    if (!spec) return [];
    const assets = await loader(spec);
    const table = assets?.pinTable;
    if (!table) return [];
    const handoff = await loadAcquisitionHandoff(deps, specHandoffId(spec));
    const facts: Array<{ property: string; facet: "terminal" | "package"; value: string; locator: string }> = [{ property: "pin_mapping", facet: "terminal", value: table.terminals, locator: `${table.locator} (pin table)` }];
    if (handoff?.pinTable?.packageCode && handoff.pinTable.mounting) facts.push({ property: "package", facet: "package", value: `${handoff.pinTable.packageCode} (${handoff.pinTable.mounting})`, locator: `${table.locator} (package line)` });
    return [candidateFromExtraction({ exactMpn, sourceId: table.source.id, sourceClass: table.source.sourceClass, method: "deterministic_inference", parserVersion: PIN_TABLE_PARSER_VERSION, documentHash: sha256(table.text), sourceRevision: table.revision, facts })];
  };
}
