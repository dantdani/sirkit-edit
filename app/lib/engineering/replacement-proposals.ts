/**
 * B14 §D — the sealed component-replacement proposal artifact
 * (`sirkit.schematic-replacement-proposal.v1`).
 *
 * A SEPARATE versioned artifact — never an overload of the Tier-1 schema.
 * Receiving or displaying one mutates nothing. It binds the complete review
 * identity: scope + canonical head mark (lineage, base head sequence, base
 * canonical-state digest), the base schematic digest, the component instance,
 * the expected current part, the exact SERVER-OWNED target identity, the one
 * canonical `schematic_replace_component` operation and its digest, the
 * deterministic impact plan and its digest, the consumed authority/canonical
 * resource identities and digests, the resource-manifest digest, provider
 * provenance, expiry, and the destructive approval tier — all under one
 * whole-body identity digest. Unknown, missing, altered, reordered,
 * duplicated, or non-canonical fields fail closed.
 *
 * The artifact carries NO reusable runtime grant: the operation's
 * `authorityGrantId` is a deterministic content-derived REGISTRY HANDLE
 * (worthless without a server-side registered branded instance, which is
 * retired before the proposal leaves the server); apply-time execution mints
 * a FRESH runtime capability after full revalidation.
 */

import { schematicStateDigest } from "./schematic-model";
import { isWellFormedAuthorizationBinding, type SchematicProposalAuthorizationBinding } from "./proposal-authorization";
import { isWellFormedProposalScope, type Tier1ProposalScope } from "./schematic-proposals";
import type { SchematicReplacementPlan } from "./schematic-plans";
import { engineeringDigest } from "./stable";
import type { EngineeringOperation } from "./types";
import type { SchematicState } from "@/lib/schematic-types";

/** [B16.0.1 §E] current schema: V2 adds the CLOSED authorization binding
 *  (verified principal + membership revision + scope + required apply role)
 *  as a load-bearing part of the sealed identity. Because the V1 contract was
 *  already exposed, V2 is an EXPLICIT new schema version: V1 artifacts (which
 *  lack the binding) refuse application with the precise code
 *  `legacy-authorization-missing` — membership authority is never guessed or
 *  backfilled into an old artifact. */
export const REPLACEMENT_PROPOSAL_SCHEMA = "sirkit.schematic-replacement-proposal.v2" as const;
export const REPLACEMENT_PROPOSAL_SCHEMA_V1 = "sirkit.schematic-replacement-proposal.v1" as const;
export const REPLACEMENT_PROPOSAL_TTL_MS = 10 * 60 * 1000;
export const REPLACEMENT_APPROVAL_TIER = "destructive" as const;

const OPERATION_DIGEST_SCHEMA = "sirkit.schematic-replacement-operation.v1";
const IMPACT_DIGEST_SCHEMA = "sirkit.schematic-replacement-impact.v1";
const IDENTITY_DIGEST_SCHEMA = "sirkit.schematic-replacement-proposal-id.v2";

/** The exact SERVER-OWNED target identity (derived from B13 exactAuthority). */
export interface ReplacementTargetIdentity {
  partId: string;
  manufacturer: string;
  atomicPartRevisionId: string;
  symbolAssetVersionId: string;
  footprintAssetVersionId: string;
  mappingCertificateId: string;
  selectionRecordId?: string;
}

/** The deterministic reviewed impact plan. Dropped connections are ALWAYS
 *  empty — a replacement that would drop a connected pin never seals. */
export interface ReplacementImpactSummary {
  mode: SchematicReplacementPlan["mode"];
  mappingEvidence: "exact-pin-identity+certificate";
  pinMapping: ReadonlyArray<{ fromPin: string; toPin: string }>;
  preservedConnections: readonly string[];
  droppedConnections: readonly string[];
  wireEndpointMoves: ReadonlyArray<{ wireId: string; end: "start" | "end"; to: { x: number; y: number } }>;
  netLabelMoves: ReadonlyArray<{ labelId: string; labelName: string; from: { x: number; y: number }; to: { x: number; y: number } }>;
  downstream: readonly string[];
  warnings: readonly string[];
}

export interface SealedReplacementProposal {
  schema: typeof REPLACEMENT_PROPOSAL_SCHEMA;
  proposalId: string;
  scope: Tier1ProposalScope;
  /** [B16.0.1 §E] the closed authorization binding — load-bearing for the
   *  apply-time membership reauthorization (§F). */
  authorization: SchematicProposalAuthorizationBinding;
  baseSchematicDigest: string;
  componentInstanceId: string;
  expectedCurrentPartId: string;
  target: ReplacementTargetIdentity;
  /** The EXACT canonical operation the approved apply will submit. */
  operation: EngineeringOperation;
  operationDigest: string;
  impact: ReplacementImpactSummary;
  impactDigest: string;
  authorityResource: { resourceId: string; contentDigest: string };
  canonicalResource: { resourceId: string; contentDigest: string };
  resourceManifestDigest: string;
  consumedAuthorityDigest: string;
  provenance: { provider: string; note: string; instruction: string };
  createdAt: number;
  expiresAt: number;
  approvalTier: typeof REPLACEMENT_APPROVAL_TIER;
}

export const REPLACEMENT_PROPOSAL_KEYS = [
  "schema", "proposalId", "scope", "authorization", "baseSchematicDigest", "componentInstanceId",
  "expectedCurrentPartId", "target", "operation", "operationDigest", "impact",
  "impactDigest", "authorityResource", "canonicalResource", "resourceManifestDigest",
  "consumedAuthorityDigest", "provenance", "createdAt", "expiresAt", "approvalTier",
] as const;

export function replacementOperationDigest(baseSchematicDigest: string, operation: EngineeringOperation): string {
  return engineeringDigest({ schema: OPERATION_DIGEST_SCHEMA, base: baseSchematicDigest, operation });
}

export function replacementImpactDigest(impact: ReplacementImpactSummary): string {
  return engineeringDigest({ schema: IMPACT_DIGEST_SCHEMA, impact });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function sealReplacementProposal(input: {
  state: SchematicState;
  scope: Tier1ProposalScope;
  /** [B16.0.1 §E] the server-verified authorization binding; must agree with
   *  the proposal scope (throws otherwise — server-side coding error). */
  authorization: SchematicProposalAuthorizationBinding;
  componentInstanceId: string;
  expectedCurrentPartId: string;
  target: ReplacementTargetIdentity;
  operation: EngineeringOperation;
  impact: ReplacementImpactSummary;
  authorityResource: { resourceId: string; contentDigest: string };
  canonicalResource: { resourceId: string; contentDigest: string };
  resourceManifestDigest: string;
  consumedAuthorityDigest: string;
  provenance: { provider: string; note: string; instruction: string };
  now: number;
}): SealedReplacementProposal {
  if (!isWellFormedAuthorizationBinding(input.authorization)
    || input.authorization.tenantId !== input.scope.tenantId
    || input.authorization.projectId !== input.scope.projectId
    || input.authorization.branchId !== input.scope.branchId) {
    throw new Error("REPLACEMENT_AUTHORIZATION_BINDING_INVALID: the sealer requires a well-formed authorization binding matching the proposal scope.");
  }
  const baseSchematicDigest = schematicStateDigest(input.state);
  const operation = structuredClone(input.operation) as EngineeringOperation;
  const impact = structuredClone(input.impact) as ReplacementImpactSummary;
  const body = {
    schema: REPLACEMENT_PROPOSAL_SCHEMA,
    scope: structuredClone(input.scope),
    authorization: structuredClone(input.authorization),
    baseSchematicDigest,
    componentInstanceId: input.componentInstanceId,
    expectedCurrentPartId: input.expectedCurrentPartId,
    target: structuredClone(input.target),
    operation,
    operationDigest: replacementOperationDigest(baseSchematicDigest, operation),
    impact,
    impactDigest: replacementImpactDigest(impact),
    authorityResource: { ...input.authorityResource },
    canonicalResource: { ...input.canonicalResource },
    resourceManifestDigest: input.resourceManifestDigest,
    consumedAuthorityDigest: input.consumedAuthorityDigest,
    provenance: { provider: input.provenance.provider, note: input.provenance.note, instruction: input.provenance.instruction },
    createdAt: input.now,
    expiresAt: input.now + REPLACEMENT_PROPOSAL_TTL_MS,
    approvalTier: REPLACEMENT_APPROVAL_TIER,
  };
  return deepFreeze({
    ...body,
    proposalId: `rprop-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}`,
  });
}

export type ReplacementProposalVerification =
  | { ok: true }
  | { ok: false; code: "malformed" | "wrong-version" | "legacy-authorization-missing" | "altered" | "stale-base" | "foreign-scope" | "stale-head" | "expired"; detail: string };

/**
 * INTEGRITY-ONLY half (B12.1 pattern): schema, closed key set, structural
 * coherence between the operation and the sealed identity fields, zero
 * dropped connections, and every sealed digest (operation, impact, and the
 * whole-body identity). No currency checks — those need the live session
 * identity and happen at the serialized execution position.
 */
export function verifySealedReplacementProposalIntegrity(proposal: SealedReplacementProposal): ReplacementProposalVerification {
  if (typeof proposal !== "object" || proposal === null) {
    return { ok: false, code: "malformed", detail: "The replacement proposal is not an object." };
  }
  // [B16.0.1 §E] a V1 artifact predates the authorization binding: membership
  // authority is never guessed or backfilled — it refuses with the PRECISE
  // legacy code and must be regenerated.
  if ((proposal as { schema?: unknown }).schema === REPLACEMENT_PROPOSAL_SCHEMA_V1) {
    return { ok: false, code: "legacy-authorization-missing", detail: "This V1 replacement proposal predates the membership authorization binding and can no longer be applied. Regenerate the proposal." };
  }
  if ((proposal as { schema?: unknown }).schema !== REPLACEMENT_PROPOSAL_SCHEMA) {
    return { ok: false, code: "wrong-version", detail: "This artifact is not a current sealed replacement proposal." };
  }
  const keys = Object.keys(proposal);
  for (const key of keys) {
    if (!(REPLACEMENT_PROPOSAL_KEYS as readonly string[]).includes(key)) {
      return { ok: false, code: "malformed", detail: `The replacement proposal carries an unknown field (${key.slice(0, 40)}).` };
    }
  }
  for (const key of REPLACEMENT_PROPOSAL_KEYS) {
    if ((proposal as unknown as Record<string, unknown>)[key] === undefined) {
      return { ok: false, code: "malformed", detail: `The replacement proposal is missing the required field (${key}).` };
    }
  }
  if (!isWellFormedProposalScope(proposal.scope)) {
    return { ok: false, code: "malformed", detail: "The replacement proposal's scope/head identity is malformed." };
  }
  // [B16.0.1 §E] the binding must be well-formed and agree with the sealed
  // scope; being inside the body, it is covered by the identity digest below.
  if (!isWellFormedAuthorizationBinding(proposal.authorization)
    || proposal.authorization.tenantId !== proposal.scope.tenantId
    || proposal.authorization.projectId !== proposal.scope.projectId
    || proposal.authorization.branchId !== proposal.scope.branchId) {
    return { ok: false, code: "malformed", detail: "The replacement proposal's authorization binding is missing, malformed, or disagrees with its scope." };
  }
  if (proposal.approvalTier !== REPLACEMENT_APPROVAL_TIER) {
    return { ok: false, code: "malformed", detail: "The replacement proposal must carry the destructive approval tier." };
  }
  const operation = proposal.operation as EngineeringOperation & {
    componentId?: string; expectedCurrentPartId?: string;
    replacement?: { partId?: string; atomicPartRevisionId?: string; symbolAssetVersionId?: string; footprintAssetVersionId?: string; mappingCertificateId?: string; selectionRecordId?: string };
  };
  if (operation.kind !== "schematic_replace_component"
    || operation.componentId !== proposal.componentInstanceId
    || operation.expectedCurrentPartId !== proposal.expectedCurrentPartId
    || operation.replacement?.partId !== proposal.target.partId
    || operation.replacement?.atomicPartRevisionId !== proposal.target.atomicPartRevisionId
    || operation.replacement?.symbolAssetVersionId !== proposal.target.symbolAssetVersionId
    || operation.replacement?.footprintAssetVersionId !== proposal.target.footprintAssetVersionId
    || operation.replacement?.mappingCertificateId !== proposal.target.mappingCertificateId
    || operation.replacement?.selectionRecordId !== proposal.target.selectionRecordId) {
    return { ok: false, code: "altered", detail: "The sealed operation does not agree with the proposal's component/target identity." };
  }
  if (!Array.isArray(proposal.impact.droppedConnections) || proposal.impact.droppedConnections.length !== 0) {
    return { ok: false, code: "malformed", detail: "A replacement proposal can never carry dropped connected pins." };
  }
  if (replacementOperationDigest(proposal.baseSchematicDigest, proposal.operation) !== proposal.operationDigest) {
    return { ok: false, code: "altered", detail: "The proposal's operation no longer matches its sealed operation digest." };
  }
  if (replacementImpactDigest(proposal.impact) !== proposal.impactDigest) {
    return { ok: false, code: "altered", detail: "The proposal's impact plan no longer matches its sealed impact digest." };
  }
  const { proposalId, ...body } = proposal;
  const recomputed = `rprop-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}`;
  if (recomputed !== proposalId) {
    return { ok: false, code: "altered", detail: "The proposal's identity digest does not match its content." };
  }
  return { ok: true };
}

/**
 * Apply-time currency verification — run against the LIVE session identity
 * immediately before execution (and re-checked inside the serialized queue
 * via the request's expectedHeadMark). Same fail-closed vocabulary as the
 * Tier-1 verifier: foreign-scope, stale-head, expired, stale-base.
 */
export function verifySealedReplacementProposal(proposal: SealedReplacementProposal, input: {
  currentSchematicDigest: string;
  now: number;
  expectedScope: Tier1ProposalScope;
}): ReplacementProposalVerification {
  const integrity = verifySealedReplacementProposalIntegrity(proposal);
  if (!integrity.ok) return integrity;
  if (!isWellFormedProposalScope(input.expectedScope)) {
    return { ok: false, code: "foreign-scope", detail: "No authoritative current scope/head identity is available to verify against." };
  }
  const sealed = proposal.scope;
  const expected = input.expectedScope;
  if (sealed.tenantId !== expected.tenantId || sealed.projectId !== expected.projectId || sealed.branchId !== expected.branchId) {
    return { ok: false, code: "foreign-scope", detail: "The replacement proposal was sealed for a different tenant/project/branch. Nothing was changed." };
  }
  if (sealed.headMark.lineageId !== expected.headMark.lineageId) {
    return { ok: false, code: "foreign-scope", detail: "The replacement proposal was sealed against a different schematic lineage. Nothing was changed." };
  }
  if (sealed.headMark.headSequence !== expected.headMark.headSequence || sealed.headMark.canonicalStateDigest !== expected.headMark.canonicalStateDigest) {
    return { ok: false, code: "stale-head", detail: "The canonical schematic head moved after this replacement proposal was created. Regenerate it from the current schematic." };
  }
  if (input.now > proposal.expiresAt) {
    return { ok: false, code: "expired", detail: "The replacement proposal has expired; regenerate it from the current schematic." };
  }
  if (input.currentSchematicDigest !== proposal.baseSchematicDigest) {
    return { ok: false, code: "stale-base", detail: "The schematic changed after this replacement proposal was created; regenerate it from the current schematic." };
  }
  return { ok: true };
}
