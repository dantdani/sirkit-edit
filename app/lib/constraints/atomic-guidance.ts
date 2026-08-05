import type { PortableAtomicSnapshot, Quantity as AtomicQuantity, EngineeringClaim, ApplicationGuidance } from "@/app/lib/atomic/types";
import { validateGuidance } from "@/app/lib/atomic/guidance";
import type {
  ConstraintDefinition,
  ConstraintDiagnostic,
  ConstraintDocument,
  ConstraintKind,
  ConstraintQuantity,
  TypedRequirement,
} from "./types";
import { canonicalUnit } from "./quantity";
import { stableConstraintId } from "./stable";

const CANONICAL_FACTOR: Record<AtomicQuantity["dimension"], number> = {
  dimensionless: 1,
  voltage: 1e6,
  current: 1e6,
  resistance: 1e6,
  capacitance: 1e15,
  inductance: 1e12,
  power: 1e6,
  frequency: 1e3,
  time: 1e9,
  temperature: 1e3,
  length: 1e9,
  mass: 1e9,
};

function decimal(value: number): string {
  const fixed = value.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "-0" ? "0" : fixed;
}

function converted(value: number, quantity: AtomicQuantity): ConstraintQuantity {
  const dimension = quantity.dimension;
  return { dimension, value: decimal(value * CANONICAL_FACTOR[dimension]), unit: canonicalUnit(dimension) };
}

function quantityRequirement(claim: EngineeringClaim): TypedRequirement | null {
  if (!claim.value || typeof claim.value !== "object" || !("dimension" in claim.value)) return null;
  const value = claim.value;
  const minimum = value.min ?? value.value ?? value.typical;
  const maximum = value.max ?? value.value ?? value.typical;
  if (claim.limit === "absolute_maximum") {
    return maximum === undefined ? null : { form: "maximum", value: converted(maximum, value) };
  }
  if (minimum !== undefined && maximum !== undefined && minimum !== maximum) {
    return { form: "range", min: converted(minimum, value), max: converted(maximum, value), minInclusive: true, maxInclusive: true };
  }
  if (minimum !== undefined) return { form: "equals", value: converted(minimum, value) };
  return null;
}

function claimKind(claim: EngineeringClaim): ConstraintKind | null {
  if (claim.property.includes("voltage")) return claim.limit === "absolute_maximum" ? "voltage_absolute_maximum" : "voltage_operating_range";
  if (claim.property.includes("current")) return "current_budget";
  return null;
}

function guidanceKind(guidance: ApplicationGuidance): ConstraintKind | null {
  return {
    decoupling: "decoupling" as const,
    regulator_stability: "decoupling" as const,
    thermal_pad: "exposed_pad_connection" as const,
    do_not_connect: "dnc_connection" as const,
    boot_strap: "terminal_connection" as const,
    reset: "terminal_connection" as const,
    layout: "placement_proximity" as const,
    reference_design: null,
    other: null,
  }[guidance.category];
}

function diagnostic(code: string, message: string, evidenceIds: string[] = []): ConstraintDiagnostic {
  return {
    id: stableConstraintId("constraint-diagnostic", { code, message, evidenceIds }),
    code,
    severity: "warning",
    message,
    constraintIds: [],
    targetIds: [],
    sourceLocations: evidenceIds.map((id) => ({ sourceId: id })),
    nextActions: ["Review the exact Stage 5 evidence/template and author any missing stable relationship before claiming enforcement."],
  };
}

function baseDefinition(input: {
  id: string;
  name: string;
  kind: ConstraintKind;
  componentInstanceId: string;
  requirement: TypedRequirement;
  snapshot: PortableAtomicSnapshot;
  evidenceIds: string[];
  sourceId: string;
  strength?: ConstraintDefinition["strength"];
}): ConstraintDefinition {
  return {
    id: input.id,
    revision: 1,
    name: input.name,
    domain: input.kind.startsWith("voltage") || input.kind === "current_budget" || input.kind === "decoupling" || input.kind.endsWith("connection") ? "application" : "placement",
    kind: input.kind,
    scope: { type: "component", id: `component:${input.componentInstanceId}` },
    selector: { objectType: "component", predicate: { kind: "ids", ids: [`component:${input.componentInstanceId}`] }, cardinality: { kind: "exactly", count: 1 } },
    requirement: input.requirement,
    strength: input.strength ?? "hard",
    severityPolicyId: "severity:component-safety",
    origin: { kind: "stage5_guidance", sourceId: input.sourceId, sourceRevision: input.snapshot.atomicRevision.semanticHash },
    evidenceIds: [...input.evidenceIds].sort(),
    lifecycle: { state: "active" },
    waiverPolicy: { eligible: false, reason: "Component safety evidence is non-waivable by default." },
    lineage: { derivedFromIds: [input.sourceId] },
  };
}

export function compileAtomicSnapshotConstraints(input: {
  snapshot: PortableAtomicSnapshot;
  componentInstanceId: string;
}): { document: ConstraintDocument; diagnostics: ConstraintDiagnostic[] } {
  const { snapshot } = input;
  const diagnostics: ConstraintDiagnostic[] = [];
  const constraints: ConstraintDefinition[] = [];
  const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
  const eligibleRevision = snapshot.atomicRevision.publicationState === "published" || snapshot.atomicRevision.publicationState === "approved";
  if (!eligibleRevision) diagnostics.push(diagnostic("ATOMIC_REVISION_NOT_APPROVED", `Atomic revision ${snapshot.atomicRevision.id} is ${snapshot.atomicRevision.publicationState}, not approved/published.`));
  if (eligibleRevision) for (const claim of [...snapshot.claims].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!snapshot.atomicRevision.claimIds.includes(claim.id)) continue;
    if (claim.state !== "source_backed" && claim.state !== "verified") {
      diagnostics.push(diagnostic("ATOMIC_CLAIM_NOT_COMPILABLE", `Claim ${claim.id} remains ${claim.state} and cannot satisfy a hard constraint.`, claim.evidenceIds));
      continue;
    }
    if (claim.evidenceIds.length === 0 || claim.evidenceIds.some((id) => !evidenceIds.has(id))) {
      diagnostics.push(diagnostic("ATOMIC_CLAIM_EVIDENCE_MISSING", `Claim ${claim.id} is not bound to complete snapshot evidence.`, claim.evidenceIds));
      continue;
    }
    const kind = claimKind(claim);
    const baseRequirement = quantityRequirement(claim);
    if (!kind || !baseRequirement) continue;
    const requirement: TypedRequirement = kind === "current_budget"
      ? baseRequirement.form === "range"
        ? { form: "budget", aggregate: "sum", limit: baseRequirement.max }
        : baseRequirement.form === "maximum"
          ? { form: "budget", aggregate: "sum", limit: baseRequirement.value }
          : baseRequirement.form === "equals" && typeof baseRequirement.value === "object" && "dimension" in baseRequirement.value
            ? { form: "budget", aggregate: "sum", limit: baseRequirement.value }
            : baseRequirement
      : baseRequirement;
    constraints.push(baseDefinition({ id: `atomic:${snapshot.atomicRevision.id}:${claim.id}:${input.componentInstanceId}`, name: `${claim.property} (${claim.limit})`, kind, componentInstanceId: input.componentInstanceId, requirement, snapshot, evidenceIds: claim.evidenceIds, sourceId: claim.id }));
  }
  if (eligibleRevision) for (const guidance of [...snapshot.guidance].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!snapshot.atomicRevision.guidanceIds.includes(guidance.id)) continue;
    const validation = validateGuidance(guidance);
    if (guidance.status !== "structured_rule_template" || validation.length > 0 || guidance.evidenceIds.some((id) => !evidenceIds.has(id))) {
      diagnostics.push(diagnostic("ATOMIC_GUIDANCE_UNSUPPORTED", `Guidance ${guidance.id} remains visible but uncompiled: ${validation.join("; ") || guidance.status}.`, guidance.evidenceIds));
      continue;
    }
    const kind = guidanceKind(guidance);
    if (!kind) {
      diagnostics.push(diagnostic("ATOMIC_GUIDANCE_UNSUPPORTED", `Guidance ${guidance.id} has no deterministic Stage 6 checker.`, guidance.evidenceIds));
      continue;
    }
    const action = String(guidance.normalizedTemplate?.action ?? "");
    const requirement: TypedRequirement = kind === "placement_proximity"
      ? { form: "require_coverage", checkerId: `placement:${action}`, minimumSupport: "compiled_for_consumer" }
      : { form: "must_exist", cardinality: { kind: "at_least", count: 1 } };
    constraints.push(baseDefinition({ id: `atomic:${snapshot.atomicRevision.id}:${guidance.id}:${input.componentInstanceId}`, name: `${guidance.category}: ${action}`, kind, componentInstanceId: input.componentInstanceId, requirement, snapshot, evidenceIds: guidance.evidenceIds, sourceId: guidance.id, strength: kind === "placement_proximity" ? "soft" : "hard" }));
  }
  return {
    document: {
      schemaVersion: 1,
      id: `constraint-set:atomic:${snapshot.atomicRevision.id}:${input.componentInstanceId}`,
      revision: 1,
      name: `Atomic application constraints for ${input.componentInstanceId}`,
      description: `Derived only from approved exact revision ${snapshot.atomicRevision.id}; unsupported prose remains diagnostic-only.`,
      extendsSetIds: [],
      constraints,
      relationships: [],
    },
    diagnostics: diagnostics.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
