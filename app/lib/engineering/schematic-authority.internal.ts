/**
 * B06.1 — INTERNAL verified-replacement-authority construction.
 *
 * NOT part of the engineering public API: the barrel (`./index`) deliberately
 * does not export this module, and the B06.1 boundary test fails if any
 * production file outside the approved composition set imports it. Approved
 * importers today: NONE in production (no UI flow performs verified-atomic
 * replacement yet — the BOM swap is explicitly catalog-unverified) and the
 * dedicated security tests under `./__tests__/`.
 *
 * The ONLY way a schematic replacement can carry `verified-atomic` authority
 * is a `VerifiedReplacementAuthority` instance minted here by consuming a
 * validated B05.1 read-resource bundle. A plain object with
 * `status: "verified-atomic"` and some identifier strings is structurally
 * rejected by the planner (`instanceof` identity check) — caller assertions,
 * provider output, deserialized JSON, and tool arguments can never become
 * authority.
 */

import { inspectComponentAuthority, type ComponentAuthorityRecord, type ComponentCatalogCandidate } from "./component-authority";
import { validateReadResourceBundle, type ReadResourceBundle } from "./resource-envelopes";
import { engineeringDigest } from "./stable";

export interface ConsumedAuthorityResource {
  resourceId: string;
  contentDigest: string;
}

let make: (input: {
  componentId: string;
  targetPartId: string;
  atomicPartRevisionId: string;
  symbolAssetVersionId?: string;
  footprintAssetVersionId?: string;
  mappingCertificateId?: string;
  selectionRecordId?: string;
  consumedResources: ConsumedAuthorityResource[];
  scope: { tenantId: string; projectId: string; branchId: string };
  canonicalRevision: string;
  grantId: string;
}) => VerifiedReplacementAuthority;

/**
 * Branded verified authority. Deserialized JSON, structural copies, and
 * spread-clones fail the `instanceof` check; `toJSON` yields an inert marker
 * so the capability never round-trips through persistence or traces.
 *
 * B06.2: every instance is also a RUNTIME GRANT registered in this module's
 * private registry under an unguessable `grantId`. The canonical executor
 * verifies the grant (never the serialized operation fields) before an
 * initial `schematic_replace_component` execution may install atomic
 * authority — see `verifyReplacementAuthorityGrant`.
 */
export class VerifiedReplacementAuthority {
  readonly componentId: string;
  readonly targetPartId: string;
  readonly atomicPartRevisionId: string;
  readonly symbolAssetVersionId?: string;
  readonly footprintAssetVersionId?: string;
  readonly mappingCertificateId?: string;
  readonly selectionRecordId?: string;
  /** Exact resource ids + content digests this authority was derived from. */
  readonly consumedResources: readonly ConsumedAuthorityResource[];
  /** Scope + canonical revision the grant was consumed against (B06.2). */
  readonly scope: Readonly<{ tenantId: string; projectId: string; branchId: string }>;
  readonly canonicalRevision: string;
  /** Registry handle carried by the operation; worthless without the registered instance. */
  readonly grantId: string;

  private constructor(input: Parameters<typeof make>[0]) {
    this.componentId = input.componentId;
    this.targetPartId = input.targetPartId;
    this.atomicPartRevisionId = input.atomicPartRevisionId;
    if (input.symbolAssetVersionId !== undefined) this.symbolAssetVersionId = input.symbolAssetVersionId;
    if (input.footprintAssetVersionId !== undefined) this.footprintAssetVersionId = input.footprintAssetVersionId;
    if (input.mappingCertificateId !== undefined) this.mappingCertificateId = input.mappingCertificateId;
    if (input.selectionRecordId !== undefined) this.selectionRecordId = input.selectionRecordId;
    this.consumedResources = Object.freeze(input.consumedResources.map((entry) => ({ ...entry })));
    this.scope = Object.freeze({ ...input.scope });
    this.canonicalRevision = input.canonicalRevision;
    this.grantId = input.grantId;
    Object.freeze(this);
  }

  static {
    make = (input) => new VerifiedReplacementAuthority(input);
  }

  toJSON(): string {
    return "[verified-replacement-authority]";
  }
}

// ─── B06.2 — runtime grant registry (module-private, non-forgeable) ──────────

const GRANT_REGISTRY_LIMIT = 100;
const activeGrants = new Map<string, VerifiedReplacementAuthority>();

/**
 * Deterministic, content-derived grant id (keeps evidence fixtures
 * byte-reproducible). The id is only a REGISTRY HANDLE: knowing or guessing
 * the string grants nothing — the executor verifies the registered branded
 * instance, which only `consumeReplacementAuthority` can create.
 */
function mintGrantId(content: unknown): string {
  return `grant-${engineeringDigest({ schema: "sirkit.replacement-authority-grant.v1", content }).slice(5)}`;
}

function registerGrant(grant: VerifiedReplacementAuthority): void {
  activeGrants.set(grant.grantId, grant);
  if (activeGrants.size > GRANT_REGISTRY_LIMIT) {
    const oldest = activeGrants.keys().next().value;
    if (oldest !== undefined) activeGrants.delete(oldest);
  }
}

/** Consume a grant after its transaction durably committed (single-use). */
export function retireReplacementAuthorityGrant(grantId: string): void {
  activeGrants.delete(grantId);
}

export type AuthorityGrantFailureCode =
  | "grant_missing"
  | "grant_scope_mismatch"
  | "grant_revision_mismatch"
  | "grant_component_mismatch"
  | "grant_part_mismatch"
  | "grant_field_mismatch"
  | "grant_resource_mismatch";

export type AuthorityGrantCheck =
  | { ok: true; consumedResources: ConsumedAuthorityResource[] }
  | { ok: false; code: AuthorityGrantFailureCode; detail: string };

/**
 * B06.2 — the canonical executor's authority gate for an INITIAL
 * `schematic_replace_component` execution that installs atomic authority.
 *
 * The serialized operation proves NOTHING by itself: `grantId` is only a
 * registry handle, and every installed field must exactly equal the
 * registered branded grant minted by `consumeReplacementAuthority` — a
 * forged, cloned, deserialized, wrong-scope, wrong-revision, wrong-part, or
 * field-mismatched operation is rejected before any mutation. Caller-supplied
 * `consumedAuthorityResources` strings are compared against the grant's own
 * records, never trusted.
 */
export function verifyReplacementAuthorityGrant(input: {
  grantId: string | undefined;
  scope: { tenantId: string; projectId: string; branchId: string };
  currentCanonicalRevision: string;
  operation: {
    componentId: string;
    replacement: { partId: string; atomicPartRevisionId?: string; symbolAssetVersionId?: string; footprintAssetVersionId?: string; mappingCertificateId?: string; selectionRecordId?: string };
    consumedAuthorityResources?: ReadonlyArray<{ resourceId: string; contentDigest: string }>;
  };
}): AuthorityGrantCheck {
  const grant = input.grantId ? activeGrants.get(input.grantId) : undefined;
  if (!grant || !(grant instanceof VerifiedReplacementAuthority)) {
    return { ok: false, code: "grant_missing", detail: "No registered runtime authority grant matches this operation; serialized operation fields are never authority." };
  }
  if (grant.scope.tenantId !== input.scope.tenantId || grant.scope.projectId !== input.scope.projectId || grant.scope.branchId !== input.scope.branchId) {
    return { ok: false, code: "grant_scope_mismatch", detail: `Grant is scoped to ${grant.scope.tenantId}/${grant.scope.projectId}/${grant.scope.branchId}.` };
  }
  if (grant.canonicalRevision !== input.currentCanonicalRevision) {
    return { ok: false, code: "grant_revision_mismatch", detail: "Grant was consumed against a different canonical revision; re-consume authority at the current head." };
  }
  if (grant.componentId !== input.operation.componentId) {
    return { ok: false, code: "grant_component_mismatch", detail: `Grant authorizes component ${grant.componentId}.` };
  }
  if (grant.targetPartId !== input.operation.replacement.partId) {
    return { ok: false, code: "grant_part_mismatch", detail: `Grant authorizes replacement part ${grant.targetPartId}.` };
  }
  const fields = ["atomicPartRevisionId", "symbolAssetVersionId", "footprintAssetVersionId", "mappingCertificateId", "selectionRecordId"] as const;
  for (const field of fields) {
    if (grant[field] !== input.operation.replacement[field]) {
      return { ok: false, code: "grant_field_mismatch", detail: `Installed ${field} does not match the grant.` };
    }
  }
  const claimed = input.operation.consumedAuthorityResources ?? [];
  const recorded = grant.consumedResources;
  const resourcesMatch = claimed.length === recorded.length && recorded.every((entry, index) => claimed[index]?.resourceId === entry.resourceId && claimed[index]?.contentDigest === entry.contentDigest);
  if (!resourcesMatch) {
    return { ok: false, code: "grant_resource_mismatch", detail: "Operation-claimed consumed resources do not match the grant's records." };
  }
  return { ok: true, consumedResources: recorded.map((entry) => ({ ...entry })) };
}

export type AuthorityConsumptionFailureCode =
  | "invalid_bundle"
  | "wrong_scope"
  | "wrong_revision"
  | "missing_authority_record"
  | "not_verified"
  | "wrong_part"
  | "incomplete_identity"
  | "asset_mismatch"
  | "stale_or_unavailable";

export interface AuthorityConsumptionFailure {
  ok: false;
  code: AuthorityConsumptionFailureCode;
  detail: string;
}

export interface AuthorityConsumptionSuccess {
  ok: true;
  authority: VerifiedReplacementAuthority;
}

export type AuthorityConsumptionResult = AuthorityConsumptionSuccess | AuthorityConsumptionFailure;

/** The component-authority-records envelope content shape (B05.1 fixtures). */
interface AuthorityRecordsContent {
  records?: ComponentAuthorityRecord[];
  candidates?: ComponentCatalogCandidate[];
}

/**
 * Consume a validated B05.1 bundle into replacement authority.
 *
 * Fail-closed validations, in order: bundle structure + every envelope digest
 * + manifest digest + scope + freshness (via `validateReadResourceBundle`);
 * the bundle's canonical revision must equal the schematic head the
 * replacement is planned against; the `component-authority-records` envelope
 * must be present, VERIFIED, and from an authoritative (non-caller) source;
 * the B05.1 inspector must classify the component `verified-exact` (candidate
 * / stale / conflicted / unresolved all refuse); the recorded atomic target
 * must match the requested target part; and the required atomic identity
 * fields must be present. The returned authority records every consumed
 * resource id + digest for the plan and the durable transaction record.
 */
export function consumeReplacementAuthority(input: {
  bundle: ReadResourceBundle;
  scope: { tenantId: string; projectId: string; branchId: string };
  /** Canonical state digest of the schematic head being planned against. */
  expectedCanonicalRevision: string;
  componentId: string;
  /** Exact part the replacement intends to install. */
  targetPartId: string;
  /** Atomic identity the caller claims — verified against the record. */
  target: {
    atomicPartRevisionId: string;
    symbolAssetVersionId?: string;
    footprintAssetVersionId?: string;
    mappingCertificateId?: string;
    selectionRecordId?: string;
  };
}): AuthorityConsumptionResult {
  const failures = validateReadResourceBundle(input.bundle, input.scope);
  if (failures.length > 0) {
    const foreign = failures.some((failure) => failure.code === "foreign_resource");
    const stale = failures.some((failure) => failure.code === "stale_resource");
    return {
      ok: false,
      code: foreign ? "wrong_scope" : stale ? "stale_or_unavailable" : "invalid_bundle",
      detail: `Authority bundle failed validation: ${failures.map((failure) => `${failure.code}(${failure.detail})`).join("; ")}`,
    };
  }
  const canonicalRevision = input.bundle.canonicalState.sourceCanonicalRevision;
  if (!canonicalRevision || canonicalRevision !== input.expectedCanonicalRevision) {
    return { ok: false, code: "wrong_revision", detail: `Authority bundle is pinned to canonical revision ${canonicalRevision ?? "(none)"} but the replacement targets ${input.expectedCanonicalRevision}.` };
  }
  const envelope = input.bundle.auxiliary.find((candidate) => candidate.kind === "component-authority-records");
  if (!envelope) {
    return { ok: false, code: "missing_authority_record", detail: "The bundle carries no component-authority-records resource." };
  }
  if (envelope.authorityStatus !== "verified") {
    return { ok: false, code: "not_verified", detail: `Authority resource ${envelope.resourceId} is ${envelope.authorityStatus}, not verified.` };
  }
  if (envelope.freshness !== "current") {
    return { ok: false, code: "stale_or_unavailable", detail: `Authority resource ${envelope.resourceId} freshness is ${envelope.freshness}.` };
  }
  const content = envelope.content as AuthorityRecordsContent;
  const summaries = inspectComponentAuthority({
    componentIds: [input.componentId],
    projectId: input.scope.projectId,
    records: content.records ?? [],
    candidates: content.candidates ?? [],
  });
  const summary = summaries[0];
  if (!summary || summary.authority === null) {
    // Conflicting records are a refused-authority state, not a missing one —
    // the B05.1 inspector never merges them.
    if (summary?.state === "conflicted") {
      return { ok: false, code: "not_verified", detail: `Component ${input.componentId} has conflicting authority records; refusing to merge. Gaps: ${summary.authorityGaps.join("; ")}.` };
    }
    return { ok: false, code: "missing_authority_record", detail: `No authority record for component ${input.componentId} (state: ${summary?.state ?? "unknown"}). Candidates are never authority.` };
  }
  if (summary.state !== "verified-exact") {
    return { ok: false, code: summary.state === "stale" ? "stale_or_unavailable" : "not_verified", detail: `Component ${input.componentId} authority state is ${summary.state}; verified-exact is required. Gaps: ${summary.authorityGaps.join("; ") || "none reported"}.` };
  }
  const record = (content.records ?? []).find((candidate) => candidate.componentId === input.componentId);
  // [B13] EXACT server-owned target authority is MANDATORY. A verified
  // replacement's installed asset IDs come from the durable exact-authority
  // block the server loader resolved — never from caller input. An MPN string
  // (selected or permitted alternative) without its own complete exact
  // authority can never mint a verified replacement.
  const exact = record?.exactAuthority;
  if (!exact) {
    const permitted = new Set([record?.selectedPart?.mpn, ...(record?.permittedAlternatives ?? [])].filter(Boolean));
    return {
      ok: false,
      code: "incomplete_identity",
      detail: permitted.has(input.targetPartId)
        ? `Component ${input.componentId} authorizes ${input.targetPartId} as a permitted part but carries no server-owned exact authority (asset revisions/versions/mapping); it is a candidate only, not a verified replacement target.`
        : `No server-owned exact authority exists for component ${input.componentId}; a caller may not supply authoritative asset identifiers.`,
    };
  }
  // The verified replacement target MUST be the server-owned selected exact
  // part. A permitted-alternative MPN is never a verified target here.
  if (input.targetPartId !== exact.mpn) {
    return { ok: false, code: "wrong_part", detail: `The server-owned verified authority is for ${exact.mpn}, not ${input.targetPartId}. Permitted alternatives without their own exact authority are candidates only.` };
  }
  // DERIVE every installed asset field from the server-owned record. When the
  // caller names a field it must EXACTLY equal the derived value — a divergent
  // symbol/footprint/mapping/selection/revision fails closed BEFORE any grant
  // is minted (B13 counterexample #7). The caller may name the component and
  // target part; it may NOT choose authoritative asset identifiers.
  const derived = {
    atomicPartRevisionId: exact.atomicPartRevisionId,
    symbolAssetVersionId: exact.symbolAssetVersionId,
    footprintAssetVersionId: exact.footprintAssetVersionId,
    mappingCertificateId: exact.mappingCertificateId,
    selectionRecordId: exact.selectionRecordId,
  } as const;
  for (const field of ["atomicPartRevisionId", "symbolAssetVersionId", "footprintAssetVersionId", "mappingCertificateId", "selectionRecordId"] as const) {
    const supplied = input.target[field];
    if (supplied !== undefined && supplied !== derived[field]) {
      return { ok: false, code: "asset_mismatch", detail: `Caller-supplied ${field} does not match the server-owned exact authority; authoritative asset identifiers are derived from the durable record, never chosen by the caller.` };
    }
  }
  // Defence in depth: the server-owned exact block must itself be complete.
  if (!derived.atomicPartRevisionId || !derived.symbolAssetVersionId || !derived.footprintAssetVersionId || !derived.mappingCertificateId) {
    return { ok: false, code: "incomplete_identity", detail: `Server-owned exact authority for component ${input.componentId} is missing a required asset identity field.` };
  }
  const consumedResources: ConsumedAuthorityResource[] = [
    { resourceId: input.bundle.canonicalState.resourceId, contentDigest: input.bundle.canonicalState.contentDigest },
    { resourceId: envelope.resourceId, contentDigest: envelope.contentDigest },
  ];
  const grantContent = {
    scope: input.scope,
    canonicalRevision: input.expectedCanonicalRevision,
    componentId: input.componentId,
    targetPartId: input.targetPartId,
    // The grant is content-identified by the SERVER-OWNED derived identity.
    target: derived,
    consumedResources,
  };
  const authority = make({
    componentId: input.componentId,
    targetPartId: input.targetPartId,
    atomicPartRevisionId: derived.atomicPartRevisionId,
    symbolAssetVersionId: derived.symbolAssetVersionId,
    footprintAssetVersionId: derived.footprintAssetVersionId,
    mappingCertificateId: derived.mappingCertificateId,
    ...(derived.selectionRecordId !== undefined ? { selectionRecordId: derived.selectionRecordId } : {}),
    consumedResources,
    scope: { ...input.scope },
    canonicalRevision: input.expectedCanonicalRevision,
    grantId: mintGrantId(grantContent),
  });
  // B06.2: register the runtime grant so the canonical executor can verify
  // it at execution time. Registration is the ONLY path to a valid grant.
  registerGrant(authority);
  return { ok: true, authority };
}
