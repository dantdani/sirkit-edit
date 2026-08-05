import { nativeComponentIdentity } from "./identity";
import { physicalBindingDigest, physicalBindingId, withBindingDigests } from "./stable";
import {
  PHYSICAL_BINDING_SCHEMA_VERSION,
  PHYSICAL_BINDING_SET_SCHEMA_VERSION,
  PHYSICAL_BINDING_POLICY_VERSION,
  type BindingOrigin,
  type ComponentPhysicalBinding,
  type ComponentPhysicalBindingSet,
  type ComponentPhysicalClassification,
  type ExactPartBinding,
  type FootprintAssetBinding,
  type LegacySourceCapture,
  type PackageBinding,
  type PhysicalBindingScope,
  type PinPadMappingReference,
  type StableComponentIdentity,
} from "./types";
import type { EngineeringActor } from "../engineering/types";
import { normalizePackageBinding, validatePhysicalBinding } from "./validation";

export interface NewPhysicalBindingCandidate {
  scope: PhysicalBindingScope;
  componentIdentity?: StableComponentIdentity;
  classification: ComponentPhysicalClassification;
  exactPart?: ExactPartBinding;
  package?: PackageBinding;
  footprint?: FootprintAssetBinding;
  pinPadMapping?: PinPadMappingReference;
  origin: BindingOrigin;
  evidenceRefs?: string[];
  applicabilityState?: ComponentPhysicalBinding["applicabilityState"];
  dependencies?: Partial<ComponentPhysicalBinding["dependencies"]>;
  legacySource?: LegacySourceCapture;
  createdAt: string;
  createdBy: EngineeringActor;
  candidateKey: string;
}

export function createPhysicalBindingCandidate(input: NewPhysicalBindingCandidate): ComponentPhysicalBinding {
  if (!input.candidateKey.trim()) throw new Error("PB_CANDIDATE_KEY_REQUIRED");
  const scope: PhysicalBindingScope = { ...structuredClone(input.scope), hierarchyPath: [...new Set(input.scope.hierarchyPath)], assemblyVariantIds: [...new Set(input.scope.assemblyVariantIds)].sort() };
  const bindingId = physicalBindingId("physical-binding", { scope, candidateKey: input.candidateKey });
  const lineageId = physicalBindingId("physical-binding-lineage", { scope, bindingId });
  const revision = 1;
  const revisionId = `${bindingId}:r${revision}`;
  const mapping: PinPadMappingReference = input.pinPadMapping ?? { state: "missing", evidenceRefs: [], reasonCodes: ["PB_MAPPING_NOT_PROVIDED"] };
  const base: Omit<ComponentPhysicalBinding, "technicalDigest" | "recordDigest"> = {
    schemaVersion: PHYSICAL_BINDING_SCHEMA_VERSION,
    bindingId,
    revisionId,
    lineageId,
    revision,
    scope,
    componentIdentity: structuredClone(input.componentIdentity ?? nativeComponentIdentity(scope)),
    classification: structuredClone(input.classification),
    ...(input.exactPart ? { exactPart: structuredClone(input.exactPart) } : {}),
    ...(input.package ? { package: normalizePackageBinding(structuredClone(input.package)) } : {}),
    ...(input.footprint ? { footprint: structuredClone(input.footprint) } : {}),
    pinPadMapping: structuredClone(mapping),
    origin: structuredClone(input.origin),
    evidenceRefs: [...new Set([...(input.evidenceRefs ?? []), ...input.origin.evidenceRefs])].sort(),
    lifecycleState: "candidate",
    applicabilityState: input.applicabilityState ?? "unknown",
    approval: { state: "unreviewed" },
    technicalValidation: { state: "pending", evidenceRefs: [], reasonCodes: ["PB_TECHNICAL_REVIEW_PENDING"] },
    freshness: { state: "unknown", reasonCodes: ["PB_FRESHNESS_NOT_EVALUATED"], staleDependencyIds: [] },
    conflict: { state: "none", conflictIds: [], reasonCodes: [] },
    dependencies: {
      approvalPolicyVersion: PHYSICAL_BINDING_POLICY_VERSION,
      variantDefinitionDigest: physicalBindingDigest(scope.assemblyVariantIds),
      exactPartFootprintCompatibility: "unknown",
      manufacturingEvidenceRefs: [],
      supplyEvidenceRefs: [],
      externalValidationRefs: [],
      ...structuredClone(input.dependencies ?? {}),
    },
    ...(input.legacySource ? { legacySource: structuredClone(input.legacySource) } : {}),
    createdAt: input.createdAt,
    createdBy: structuredClone(input.createdBy),
  };
  const binding = withBindingDigests(base);
  const issues = validatePhysicalBinding(binding);
  if (issues.length) throw new Error(`${issues[0]!.code}:${issues[0]!.path}`);
  return binding;
}

export function createBindingSet(binding: ComponentPhysicalBinding, at = binding.createdAt): ComponentPhysicalBindingSet {
  const base = {
    schemaVersion: PHYSICAL_BINDING_SET_SCHEMA_VERSION,
    setId: physicalBindingId("physical-binding-set", binding.scope),
    scope: structuredClone(binding.scope),
    revision: 1,
    candidateRevisionIds: [binding.revisionId],
    updatedAt: at,
  };
  return { ...base, recordDigest: physicalBindingDigest(base) };
}

export function reviseBindingSet(set: ComponentPhysicalBindingSet, input: { replaceRevisionId?: string; addRevisionId?: string; selectedRevisionId?: string | null; at: string }): ComponentPhysicalBindingSet {
  let candidates = [...set.candidateRevisionIds];
  if (input.replaceRevisionId && input.addRevisionId) candidates = candidates.map((id) => id === input.replaceRevisionId ? input.addRevisionId! : id);
  else if (input.addRevisionId && !candidates.includes(input.addRevisionId)) candidates.push(input.addRevisionId);
  candidates = [...new Set(candidates)].sort();
  const base = {
    ...set,
    revision: set.revision + 1,
    candidateRevisionIds: candidates,
    ...(input.selectedRevisionId === null ? { effectiveSelectedRevisionId: undefined } : input.selectedRevisionId ? { effectiveSelectedRevisionId: input.selectedRevisionId } : {}),
    updatedAt: input.at,
    recordDigest: undefined,
  };
  return { ...base, recordDigest: physicalBindingDigest(base) } as ComponentPhysicalBindingSet;
}
