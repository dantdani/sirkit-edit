/**
 * [PR-M, 2026-10-17] Section M.2.4: the SEALED UNRESOLVED-COMPONENT RESOLUTION proposal - one coherent BATCH over stable instance
 * ids (D1 and D2 together, never two uncoordinated edits), each item naming the instance's current identity, the exact eligible
 * candidate revision chosen for it, the proved pin mapping (a permutation only when proved by function), the reviewed wire and
 * label moves and the material warnings; the whole batch bound to the base schematic digest, the canonical head mark, the run's
 * server-verified authorization identity and the server-derived catalog authority resource.
 *
 * It is the separate, deliberate sibling of the narrower B14 exact replacement (app/lib/engineering/replacement-proposals.ts),
 * which stays unchanged for already-qualified parts: B14 needs a durable physical binding's verified-exact target and the CURRENT
 * part's published revision; a resolution exists precisely because the instance has no published exact revision yet, so its
 * current pins come from the current catalog symbol and its target from the catalog's published link.
 *
 * Receiving or displaying the artifact changes NOTHING. It carries the exact canonical operations the reviewed apply submits
 * (one `schematic_replace_component` per item, in item order, ONE transaction), whose embedded grant handles are worthless
 * without the fresh server-side grants the apply re-mints (app/lib/component-resolution/approved-resolution-mutations.ts).
 * Pure: sealing and verification only.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "../engineering/schematic-model";
import { isWellFormedAuthorizationBinding, type SchematicProposalAuthorizationBinding } from "../engineering/proposal-authorization";
import { isWellFormedProposalScope, type Tier1ProposalScope } from "../engineering/schematic-proposals";
import { engineeringDigest } from "../engineering/stable";
import type { EngineeringOperation } from "../engineering/types";
import type { PinMappingEntry, ResolutionRequirement } from "./compatibility";

export const RESOLUTION_PROPOSAL_SCHEMA = "sirkit.component-resolution-proposal.v1" as const;
export const RESOLUTION_PROPOSAL_TTL_MS = 10 * 60 * 1000;
export const RESOLUTION_APPROVAL_TIER = "destructive" as const;
/** The canonical command the reviewed apply submits (action-registry record, executor binding). */
export const RESOLUTION_COMMAND_ID = "schematic.resolve-components" as const;
export const MAX_RESOLUTION_ITEMS = 20;
const OPERATIONS_DIGEST_SCHEMA = "sirkit.component-resolution-operations.v1";
const IMPACT_DIGEST_SCHEMA = "sirkit.component-resolution-impact.v1";
const IDENTITY_DIGEST_SCHEMA = "sirkit.component-resolution-proposal-id.v1";
/** The proposal id prefix (the shared approved-mutation journal admits it beside `prop-` and `rprop-`). */
export const RESOLUTION_PROPOSAL_ID_PREFIX = "cprop-" as const;

/** The exact server-derived target of one item (catalog link + published evidence). */
export interface ResolutionTargetIdentity {
  catalogPartId: string;
  valueKey: string;
  exactMpn: string;
  manufacturer: string;
  atomicPartRevisionId: string;
  symbolAssetVersionId: string;
  footprintAssetVersionId: string;
  mappingCertificateId: string;
  footprintFullName: string;
  evidenceDigest: string;
}

export interface ResolutionItem {
  componentInstanceId: string;
  refDes: string;
  value: string;
  current: { partId: string; atomicPartRevisionId: string | null; symbolAssetVersionId: string | null; missing: string | null };
  target: ResolutionTargetIdentity;
  mode: "same-part-binding" | "part-replacement";
  mapping: PinMappingEntry[];
  permutation: boolean;
  equivalence: "pin-function-and-package" | "pin-function-package-and-stated-ratings";
  /** The nets on the instance's connected pins BEFORE the change; the apply proves they are unchanged AFTER it. */
  nets: Array<{ pin: string; net: string }>;
  wireEndpointMoves: Array<{ wireId: string; end: "start" | "end"; to: { x: number; y: number } }>;
  netLabelMoves: Array<{ labelId: string; labelName: string; from: { x: number; y: number }; to: { x: number; y: number } }>;
  warnings: string[];
  evidence: string[];
}

/** What the whole batch must preserve, and how the apply proves it (the reviewed postconditions). */
export interface ResolutionImpact {
  items: ResolutionItem[];
  /** Digest of the sheet's net partition (endpoints mapped through each item's pin mapping) the apply must reproduce. */
  connectivityDigest: string;
  unaffectedComponents: number;
  downstream: string[];
}

export interface SealedResolutionProposal {
  schema: typeof RESOLUTION_PROPOSAL_SCHEMA;
  proposalId: string;
  scope: Tier1ProposalScope;
  authorization: SchematicProposalAuthorizationBinding;
  baseSchematicDigest: string;
  requirement: ResolutionRequirement;
  impact: ResolutionImpact;
  impactDigest: string;
  /** The EXACT canonical operations the approved apply submits, in item order (one transaction). */
  operations: EngineeringOperation[];
  operationsDigest: string;
  authorityResource: { resourceId: string; contentDigest: string };
  canonicalResource: { resourceId: string; contentDigest: string };
  resourceManifestDigest: string;
  consumedAuthorityDigest: string;
  provenance: { provider: string; note: string; instruction: string };
  createdAt: number;
  expiresAt: number;
  approvalTier: typeof RESOLUTION_APPROVAL_TIER;
}

export const RESOLUTION_PROPOSAL_KEYS = [
  "schema", "proposalId", "scope", "authorization", "baseSchematicDigest", "requirement", "impact", "impactDigest", "operations",
  "operationsDigest", "authorityResource", "canonicalResource", "resourceManifestDigest", "consumedAuthorityDigest", "provenance",
  "createdAt", "expiresAt", "approvalTier",
] as const;

export function resolutionOperationsDigest(baseSchematicDigest: string, operations: readonly EngineeringOperation[]): string {
  return engineeringDigest({ schema: OPERATIONS_DIGEST_SCHEMA, base: baseSchematicDigest, operations });
}

export function resolutionImpactDigest(impact: ResolutionImpact, requirement: ResolutionRequirement): string {
  return engineeringDigest({ schema: IMPACT_DIGEST_SCHEMA, impact, requirement });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function sealResolutionProposal(input: {
  state: SchematicState;
  scope: Tier1ProposalScope;
  authorization: SchematicProposalAuthorizationBinding;
  requirement: ResolutionRequirement;
  impact: ResolutionImpact;
  operations: EngineeringOperation[];
  authorityResource: { resourceId: string; contentDigest: string };
  canonicalResource: { resourceId: string; contentDigest: string };
  resourceManifestDigest: string;
  consumedAuthorityDigest: string;
  provenance: { provider: string; note: string; instruction: string };
  now: number;
}): SealedResolutionProposal {
  if (!isWellFormedAuthorizationBinding(input.authorization)
    || input.authorization.tenantId !== input.scope.tenantId
    || input.authorization.projectId !== input.scope.projectId
    || input.authorization.branchId !== input.scope.branchId) {
    throw new Error("RESOLUTION_AUTHORIZATION_BINDING_INVALID: the sealer requires a well-formed authorization binding matching the proposal scope.");
  }
  const baseSchematicDigest = schematicStateDigest(input.state);
  const operations = structuredClone(input.operations) as EngineeringOperation[];
  const impact = structuredClone(input.impact) as ResolutionImpact;
  const requirement = structuredClone(input.requirement) as ResolutionRequirement;
  const body = {
    schema: RESOLUTION_PROPOSAL_SCHEMA,
    scope: structuredClone(input.scope),
    authorization: structuredClone(input.authorization),
    baseSchematicDigest,
    requirement,
    impact,
    impactDigest: resolutionImpactDigest(impact, requirement),
    operations,
    operationsDigest: resolutionOperationsDigest(baseSchematicDigest, operations),
    authorityResource: { ...input.authorityResource },
    canonicalResource: { ...input.canonicalResource },
    resourceManifestDigest: input.resourceManifestDigest,
    consumedAuthorityDigest: input.consumedAuthorityDigest,
    provenance: { provider: input.provenance.provider, note: input.provenance.note, instruction: input.provenance.instruction },
    createdAt: input.now,
    expiresAt: input.now + RESOLUTION_PROPOSAL_TTL_MS,
    approvalTier: RESOLUTION_APPROVAL_TIER,
  };
  return deepFreeze({ ...body, proposalId: `${RESOLUTION_PROPOSAL_ID_PREFIX}${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}` });
}

export type ResolutionProposalVerification =
  | { ok: true }
  | { ok: false; code: "malformed" | "wrong-version" | "altered" | "stale-base" | "foreign-scope" | "stale-head" | "expired"; detail: string };

/** INTEGRITY-ONLY: schema, closed keys, item/operation coherence, every digest. No currency (that needs the live session). */
export function verifySealedResolutionProposalIntegrity(proposal: SealedResolutionProposal): ResolutionProposalVerification {
  if (typeof proposal !== "object" || proposal === null) return { ok: false, code: "malformed", detail: "The resolution proposal is not an object." };
  if ((proposal as { schema?: unknown }).schema !== RESOLUTION_PROPOSAL_SCHEMA) return { ok: false, code: "wrong-version", detail: "This artifact is not a current sealed component resolution proposal." };
  for (const key of Object.keys(proposal)) if (!(RESOLUTION_PROPOSAL_KEYS as readonly string[]).includes(key)) return { ok: false, code: "malformed", detail: `The resolution proposal carries an unknown field (${key.slice(0, 40)}).` };
  for (const key of RESOLUTION_PROPOSAL_KEYS) if ((proposal as unknown as Record<string, unknown>)[key] === undefined) return { ok: false, code: "malformed", detail: `The resolution proposal is missing the required field (${key}).` };
  if (!isWellFormedProposalScope(proposal.scope)) return { ok: false, code: "malformed", detail: "The resolution proposal's scope/head identity is malformed." };
  if (!isWellFormedAuthorizationBinding(proposal.authorization) || proposal.authorization.tenantId !== proposal.scope.tenantId || proposal.authorization.projectId !== proposal.scope.projectId || proposal.authorization.branchId !== proposal.scope.branchId) {
    return { ok: false, code: "malformed", detail: "The resolution proposal's authorization binding is missing, malformed, or disagrees with its scope." };
  }
  if (proposal.approvalTier !== RESOLUTION_APPROVAL_TIER) return { ok: false, code: "malformed", detail: "The resolution proposal must carry the destructive approval tier." };
  const items = proposal.impact?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_RESOLUTION_ITEMS || !Array.isArray(proposal.operations) || proposal.operations.length !== items.length) {
    return { ok: false, code: "malformed", detail: "The resolution proposal must carry 1-20 items with exactly one operation each." };
  }
  if (new Set(items.map((item) => item.componentInstanceId)).size !== items.length) return { ok: false, code: "malformed", detail: "A resolution batch names each instance once." };
  for (const [index, item] of items.entries()) {
    const operation = proposal.operations[index] as EngineeringOperation & { componentId?: string; expectedCurrentPartId?: string; replacement?: { partId?: string; value?: string; atomicPartRevisionId?: string; symbolAssetVersionId?: string; footprintAssetVersionId?: string; mappingCertificateId?: string; selectionRecordId?: string } };
    if (operation.kind !== "schematic_replace_component"
      || operation.componentId !== item.componentInstanceId
      || operation.expectedCurrentPartId !== item.current.partId
      || operation.replacement?.partId !== item.target.catalogPartId
      || operation.replacement?.value !== undefined
      || operation.replacement?.atomicPartRevisionId !== item.target.atomicPartRevisionId
      || operation.replacement?.symbolAssetVersionId !== item.target.symbolAssetVersionId
      || operation.replacement?.footprintAssetVersionId !== item.target.footprintAssetVersionId
      || operation.replacement?.mappingCertificateId !== item.target.mappingCertificateId
      || operation.replacement?.selectionRecordId !== undefined) {
      return { ok: false, code: "altered", detail: `The sealed operation ${index} does not agree with its item's instance/target identity (the value is always kept).` };
    }
  }
  if (resolutionOperationsDigest(proposal.baseSchematicDigest, proposal.operations) !== proposal.operationsDigest) return { ok: false, code: "altered", detail: "The proposal's operations no longer match their sealed digest." };
  if (resolutionImpactDigest(proposal.impact, proposal.requirement) !== proposal.impactDigest) return { ok: false, code: "altered", detail: "The proposal's impact no longer matches its sealed digest." };
  const { proposalId, ...body } = proposal;
  if (`${RESOLUTION_PROPOSAL_ID_PREFIX}${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}` !== proposalId) return { ok: false, code: "altered", detail: "The proposal's identity digest does not match its content." };
  return { ok: true };
}

/** Apply-time currency against the LIVE session identity (re-checked inside the serialized queue by the request's head mark). */
export function verifySealedResolutionProposal(proposal: SealedResolutionProposal, input: { currentSchematicDigest: string; now: number; expectedScope: Tier1ProposalScope }): ResolutionProposalVerification {
  const integrity = verifySealedResolutionProposalIntegrity(proposal);
  if (!integrity.ok) return integrity;
  if (!isWellFormedProposalScope(input.expectedScope)) return { ok: false, code: "foreign-scope", detail: "No authoritative current scope/head identity is available to verify against." };
  const sealed = proposal.scope;
  const expected = input.expectedScope;
  if (sealed.tenantId !== expected.tenantId || sealed.projectId !== expected.projectId || sealed.branchId !== expected.branchId) return { ok: false, code: "foreign-scope", detail: "The resolution proposal was sealed for a different tenant/project/branch. Nothing was changed." };
  if (sealed.headMark.lineageId !== expected.headMark.lineageId) return { ok: false, code: "foreign-scope", detail: "The resolution proposal was sealed against a different schematic lineage. Nothing was changed." };
  if (sealed.headMark.headSequence !== expected.headMark.headSequence || sealed.headMark.canonicalStateDigest !== expected.headMark.canonicalStateDigest) return { ok: false, code: "stale-head", detail: "The canonical schematic head moved after this resolution proposal was created. Regenerate it from the current schematic." };
  if (input.now > proposal.expiresAt) return { ok: false, code: "expired", detail: "The resolution proposal has expired; regenerate it from the current schematic." };
  if (input.currentSchematicDigest !== proposal.baseSchematicDigest) return { ok: false, code: "stale-base", detail: "The schematic changed after this resolution proposal was created; regenerate it from the current schematic." };
  return { ok: true };
}
