import { createHash } from "node:crypto";
import { PHYSICAL_BINDING_CANONICAL_VERSION, type ComponentPhysicalBinding, type PhysicalBindingScope } from "./types";

const TECHNICAL_SET_KEYS = new Set(["assemblyVariantIds", "evidenceRefs", "decisionEvidenceRefs", "reasonCodes", "staleDependencyIds", "conflictIds", "padIdentifiers", "duplicatePadIdentifiers", "externalValidationRefs", "hierarchyPath", "recognizedFields", "unrecognizedFields"]);

function normalizeString(value: string): string {
  return value.normalize("NFC");
}

function canonicalValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") return normalizeString(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("PHYSICAL_BINDING_NON_FINITE_NUMBER");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalValue(item));
    return key && TECHNICAL_SET_KEYS.has(key)
      ? [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([childKey, child]) => [childKey, canonicalValue(child, childKey)]));
  }
  return value;
}

export function canonicalPhysicalBindingJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function physicalBindingDigest(value: unknown): string {
  const body = canonicalPhysicalBindingJson({ canonicalVersion: PHYSICAL_BINDING_CANONICAL_VERSION, value });
  return `pb1-${createHash("sha256").update(body).digest("hex")}`;
}

export function physicalBindingId(kind: string, value: unknown): string {
  return `${kind}:${physicalBindingDigest(value).slice(4, 36)}`;
}

export function scopeKey(scope: PhysicalBindingScope): string {
  return physicalBindingDigest({
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    branchId: scope.branchId,
    boardInstanceId: scope.boardInstanceId,
    componentInstanceId: scope.componentInstanceId,
    hierarchyPath: scope.hierarchyPath,
    assemblyVariantIds: scope.assemblyVariantIds,
  });
}

export function bindingTechnicalPayload(binding: Omit<ComponentPhysicalBinding, "technicalDigest" | "recordDigest">): unknown {
  return {
    schemaVersion: binding.schemaVersion,
    scope: binding.scope,
    componentIdentity: binding.componentIdentity,
    classification: binding.classification,
    exactPart: binding.exactPart,
    package: binding.package,
    footprint: binding.footprint,
    pinPadMapping: binding.pinPadMapping,
    applicabilityState: binding.applicabilityState,
    evidenceRefs: binding.evidenceRefs,
    dependencies: binding.dependencies,
  };
}

export function withBindingDigests(input: Omit<ComponentPhysicalBinding, "technicalDigest" | "recordDigest">): ComponentPhysicalBinding {
  const technicalDigest = physicalBindingDigest(bindingTechnicalPayload(input));
  const recordDigest = physicalBindingDigest({ ...input, technicalDigest });
  return { ...input, technicalDigest, recordDigest };
}

export function withoutBindingDigests(binding: ComponentPhysicalBinding): Omit<ComponentPhysicalBinding, "technicalDigest" | "recordDigest"> {
  return Object.fromEntries(Object.entries(binding).filter(([key]) => key !== "technicalDigest" && key !== "recordDigest")) as Omit<ComponentPhysicalBinding, "technicalDigest" | "recordDigest">;
}

export function deepFreezeBinding<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeBinding(child);
  }
  return value;
}
