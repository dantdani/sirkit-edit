import type { ConstraintDefinition, ConstraintKind, ConstraintObjectType, ConstraintStrength, TypedRequirement } from "../constraints/types";
import { requirementsDigest, requirementsId } from "./stable";
import type { ConstraintPatchProposal, ConstraintProposalItem, Requirement, RequirementPredicate, RequirementStrength } from "./types";

export const REQUIREMENT_LOWERING_VERSION = "sirkit-requirement-lowering/1.0.0" as const;

interface Rule {
  role: string;
  constraintKind?: ConstraintKind;
  targetType: ConstraintObjectType;
  resolutionStage: string;
  acceptedForms: RequirementPredicate["form"][];
}

const RULES: Rule[] = [
  { role: "pcb.trace_width", constraintKind: "trace_width", targetType: "net_class", resolutionStage: "PCB Stage 6", acceptedForms: ["minimum", "maximum", "range", "target", "equals"] },
  { role: "pcb.clearance", constraintKind: "clearance", targetType: "net_class", resolutionStage: "PCB Stage 6", acceptedForms: ["minimum", "maximum", "range", "equals"] },
  { role: "pcb.via_diameter", constraintKind: "via_diameter", targetType: "net_class", resolutionStage: "PCB Stage 6", acceptedForms: ["minimum", "maximum", "range", "equals"] },
  { role: "pcb.via_drill", constraintKind: "via_drill", targetType: "net_class", resolutionStage: "PCB Stage 6", acceptedForms: ["minimum", "maximum", "range", "equals"] },
  { role: "pcb.route_length", constraintKind: "route_length", targetType: "net", resolutionStage: "PCB Stage 6", acceptedForms: ["minimum", "maximum", "range", "target", "equals"] },
  { role: "pcb.pair_skew", constraintKind: "pair_skew", targetType: "differential_pair", resolutionStage: "PCB Stage 6", acceptedForms: ["maximum", "target", "equals"] },
  { role: "pcb.target_impedance", constraintKind: "target_impedance", targetType: "differential_pair", resolutionStage: "PCB Stage 6", acceptedForms: ["target", "equals", "range"] },
  { role: "power_source", targetType: "rail", resolutionStage: "CD-2/CD-3", acceptedForms: ["minimum", "maximum", "range", "target", "equals"] },
  { role: "interface", targetType: "interface", resolutionStage: "CD-4", acceptedForms: ["must_exist", "equals", "allowed_set", "required_set"] },
  { role: "board_outline", targetType: "board", resolutionStage: "CD-2/PCB Stage 6", acceptedForms: ["maximum", "range", "containment"] },
  { role: "component_selection", targetType: "atomic_part", resolutionStage: "CD-6", acceptedForms: ["allowed_set", "forbidden_set", "equals", "minimum", "maximum", "range"] },
];

function strength(value: RequirementStrength): ConstraintStrength {
  if (value === "hard" || value === "externally_mandated") return "hard";
  if (value === "soft_preference" || value === "target") return "soft";
  return "advisory";
}

function stage6Predicate(predicate: RequirementPredicate): TypedRequirement | undefined {
  if (["qualitative_rubric", "external_evidence", "temporal_sequence"].includes(predicate.form)) return undefined;
  return predicate as TypedRequirement;
}

function quantities(predicate: RequirementPredicate): string[] {
  if (predicate.form === "minimum" || predicate.form === "maximum") return [`${predicate.value.value} ${predicate.value.unit}`];
  if (predicate.form === "range") return [`${predicate.min.value} ${predicate.min.unit}`, `${predicate.max.value} ${predicate.max.unit}`];
  if (predicate.form === "target") return [`${predicate.value.value} ${predicate.value.unit}`, `${predicate.toleranceMinus.value} ${predicate.toleranceMinus.unit}`, `${predicate.tolerancePlus.value} ${predicate.tolerancePlus.unit}`];
  return [];
}

function lowerRequirement(requirement: Requirement, projectId: string): ConstraintProposalItem[] {
  if (requirement.status === "rejected" || requirement.status === "superseded" || requirement.strength === "informational") return [];
  const roles = requirement.subjectRefsOrRoles.length ? requirement.subjectRefsOrRoles : ["unresolved"];
  return roles.map((role) => {
    const rule = RULES.find((candidate) => role === candidate.role || role.startsWith(`${candidate.role}:`));
    const common = {
      proposalItemId: requirementsId("constraint-proposal-item", { requirement: requirement.requirementId, revision: requirement.revision, role }),
      requirementId: requirement.requirementId,
      requirementRevision: requirement.revision,
      sourceRefIds: requirement.originalSourceRefs.map((item) => `${item.sourceId}@${item.sourceVersion}`).sort(),
      assumptionRefs: [...requirement.assumptionRefs].sort(),
      normalizedUnits: quantities(requirement.typedPredicate),
      ...(requirement.applicabilityCondition ? { condition: requirement.applicabilityCondition } : {}),
      strength: requirement.strength,
      loweringRuleVersion: REQUIREMENT_LOWERING_VERSION,
    };
    if (!rule) return { ...common, state: "unsupported" as const, limitations: [`No deterministic Stage 6 lowering rule exists for role '${role}'. The requirement remains authoritative and its verification obligation remains visible.`] };
    const typed = stage6Predicate(requirement.typedPredicate);
    if (!rule.acceptedForms.includes(requirement.typedPredicate.form) || !typed) return { ...common, state: "unsupported" as const, limitations: [`Role '${rule.role}' does not accept predicate form '${requirement.typedPredicate.form}'.`] };
    const explicitTargetId = role.split(":").slice(1).join(":");
    if (!explicitTargetId || !rule.constraintKind) return { ...common, state: "deferred" as const, deferredScope: { role: rule.role, expectedObjectType: rule.targetType, resolutionStage: rule.resolutionStage, selectorMustNotInventObjects: true as const }, limitations: [rule.constraintKind ? "The target role is typed but cannot resolve to a stable design object before the owning stage." : "The requirement needs a later-stage object and/or a Stage 6 vocabulary extension; no object is invented."] };
    const constraintId = requirementsId("constraint", { requirement: requirement.requirementId, revision: requirement.revision, role, kind: rule.constraintKind });
    const constraint: ConstraintDefinition = {
      id: constraintId,
      revision: 1,
      name: requirement.title,
      description: requirement.normalizedStatement,
      domain: requirement.domain === "pcb_placement_routing_stackup" ? (rule.constraintKind.startsWith("placement_") ? "placement" : "routing") : requirement.domain === "manufacturing_assembly" ? "manufacturing" : "application",
      kind: rule.constraintKind,
      scope: { type: "project", id: projectId },
      selector: { objectType: rule.targetType, predicate: { kind: "ids", ids: [explicitTargetId] }, cardinality: { kind: "exactly", count: 1 } },
      ...(requirement.applicabilityCondition ? { condition: requirement.applicabilityCondition } : {}),
      requirement: typed,
      strength: strength(requirement.strength),
      severityPolicyId: "requirements-derived/default-v1",
      origin: { kind: "project", sourceId: requirement.requirementId, sourceRevision: String(requirement.revision), actorId: requirement.createdBy, reviewState: "proposed" },
      evidenceIds: [],
      lifecycle: { state: "draft" },
      waiverPolicy: { eligible: false, reason: "Requirement-derived hard truth cannot be waived at lowering time." },
      lineage: { derivedFromIds: [requirement.requirementId] },
    };
    return { ...common, state: "ready" as const, constraint, limitations: ["Constraint remains draft and cannot activate without Stage 6 compilation plus approval."] };
  });
}

export function lowerRequirementsToConstraintProposal(input: { projectId: string; packageId: string; packageRevision: number; requirements: readonly Requirement[] }): ConstraintPatchProposal {
  const items = input.requirements.flatMap((requirement) => lowerRequirement(requirement, input.projectId)).sort((left, right) => left.proposalItemId.localeCompare(right.proposalItemId));
  const ready = items.flatMap((item) => item.constraint ? [item.constraint] : []);
  const document = { schemaVersion: 1 as const, id: requirementsId("constraint-document", { package: input.packageId, revision: input.packageRevision }), revision: input.packageRevision, name: `CD-1 requirements proposal ${input.packageId}@${input.packageRevision}`, description: "Draft Stage 6 constraints derived deterministically from a requirements package. Not active.", extendsSetIds: [], constraints: ready, relationships: [] };
  const base = { proposalId: requirementsId("constraint-proposal", { package: input.packageId, revision: input.packageRevision, items: items.map((item) => item.proposalItemId) }), projectId: input.projectId, packageId: input.packageId, packageRevision: input.packageRevision, stage6Document: document, items, approvalStatus: "proposed" as const, activationState: "not_active" as const, compilerVersion: REQUIREMENT_LOWERING_VERSION };
  return { ...base, deterministicDigest: requirementsDigest(base) };
}

