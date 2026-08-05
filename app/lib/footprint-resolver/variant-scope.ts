export const ASSEMBLY_VARIANT_SCOPE_CONTRACT_VERSION = "sirkit.assembly-variant-scope/1.0.0" as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/;
const MAX_VARIANTS = 128;

export interface AssemblyVariantScopeInspection {
  contractVersion: typeof ASSEMBLY_VARIANT_SCOPE_CONTRACT_VERSION;
  normalized: string[];
  kind: "global" | "explicit" | "invalid";
  applies: boolean;
  errors: Array<"VARIANT_SCOPE_REQUIRED" | "VARIANT_SCOPE_LIMIT_EXCEEDED" | "VARIANT_SCOPE_ID_INVALID" | "REQUEST_VARIANT_REQUIRED">;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * The shared B1/B2/B4/B5 applicability contract. An explicit empty array is
 * global. Missing or malformed authority scope is never promoted to global.
 */
export function inspectAssemblyVariantScope(scope: unknown, requestedVariantId: unknown): AssemblyVariantScopeInspection {
  const errors: AssemblyVariantScopeInspection["errors"] = [];
  if (!Array.isArray(scope)) errors.push("VARIANT_SCOPE_REQUIRED");
  else {
    if (scope.length > MAX_VARIANTS) errors.push("VARIANT_SCOPE_LIMIT_EXCEEDED");
    if (scope.some((variant) => !validId(variant))) errors.push("VARIANT_SCOPE_ID_INVALID");
  }
  if (!validId(requestedVariantId)) errors.push("REQUEST_VARIANT_REQUIRED");
  const normalized = Array.isArray(scope)
    ? [...new Set(scope.filter(validId).map((variant) => variant.normalize("NFC")))].sort((a, b) => a.localeCompare(b))
    : [];
  const valid = errors.length === 0;
  return {
    contractVersion: ASSEMBLY_VARIANT_SCOPE_CONTRACT_VERSION,
    normalized,
    kind: valid ? (normalized.length === 0 ? "global" : "explicit") : "invalid",
    applies: valid && (normalized.length === 0 || normalized.includes(requestedVariantId as string)),
    errors: [...new Set(errors)].sort(),
  };
}

export function normalizeAssemblyVariantScope(scope: unknown): string[] {
  const inspected = inspectAssemblyVariantScope(scope, "normalization-probe");
  if (inspected.errors.some((error) => error !== "REQUEST_VARIANT_REQUIRED")) throw new Error(`FR_${inspected.errors[0]}`);
  return inspected.normalized;
}

export function assemblyVariantScopeApplies(scope: unknown, requestedVariantId: unknown): boolean {
  return inspectAssemblyVariantScope(scope, requestedVariantId).applies;
}
