import { compareQuantities, quantityKey } from "../constraints/quantity";
import type { ConstraintQuantity, ConstraintScalar } from "../constraints/types";
import type { Requirement, RequirementConflict, RequirementDiagnostic, RequirementPredicate } from "./types";
import { requirementsDigest, requirementsId } from "./stable";

const VAGUE_TERMS = ["fast", "small", "cheap", "low power", "industrial", "robust", "high performance", "long battery life", "user friendly", "as needed", "adequate"];
const NUMERIC_FORMS = new Set(["minimum", "maximum", "range", "target", "distance", "budget"]);

function diagnostic(requirement: Requirement, code: string, severity: RequirementDiagnostic["severity"], message: string, missingFields: string[] = []): RequirementDiagnostic {
  return { diagnosticId: requirementsId("reqdiag", { requirement: requirement.requirementId, revision: requirement.revision, code, missingFields }), code, severity, requirementIds: [requirement.requirementId], sourceRefs: requirement.originalSourceRefs, message, missingFields, nextActions: ["Clarify the cited source or provide an authorized structured answer"] };
}

export function analyzeRequirementQuality(requirements: readonly Requirement[], candidateMetadata: ReadonlyMap<string, { ambiguityNotes: string[]; missingFields: string[] }>): RequirementDiagnostic[] {
  const diagnostics: RequirementDiagnostic[] = [];
  for (const requirement of requirements) {
    const text = requirement.normalizedStatement.toLowerCase();
    const vague = VAGUE_TERMS.filter((term) => text.includes(term));
    if (vague.length) diagnostics.push(diagnostic(requirement, "VAGUE_QUALITATIVE_TERM", "warning", `The statement uses undefined qualitative terms: ${vague.join(", ")}.`, ["operational definition"]));
    if (!requirement.subjectRefsOrRoles.length) diagnostics.push(diagnostic(requirement, "SUBJECT_OR_ROLE_MISSING", "error", "The requirement has no explicit subject or deferred design role.", ["subjectRefsOrRoles"]));
    if (NUMERIC_FORMS.has(requirement.typedPredicate.form) && !requirement.operatingConditions.length && ["analog_performance", "electrical_supply_load", "power_energy_battery", "timing_latency_bandwidth", "environmental"].includes(requirement.domain)) diagnostics.push(diagnostic(requirement, "REFERENCE_CONDITION_MISSING", "warning", "A numeric engineering requirement lacks operating or measurement conditions.", ["operatingConditions"]));
    if (/\b(?:and|as well as)\b/i.test(requirement.normalizedStatement) && requirement.typedPredicate.form !== "must_connect" && requirement.typedPredicate.form !== "temporal_sequence") diagnostics.push(diagnostic(requirement, "POSSIBLE_COMPOUND_REQUIREMENT", "warning", "The source may combine independently verifiable outcomes and should be reviewed for splitting."));
    if (/\b(?:should eventually|would be nice|hopefully|in the future)\b/i.test(text)) diagnostics.push(diagnostic(requirement, "ASPIRATION_AS_REQUIREMENT", "warning", "Future-tense aspiration is not an unambiguous requirement."));
    if (/\b(?:this|that|it|they)\b/i.test(text) && !requirement.subjectRefsOrRoles.length) diagnostics.push(diagnostic(requirement, "AMBIGUOUS_REFERENCE", "warning", "A pronoun has no resolved subject."));
    if (requirement.kind === "external_approval_certification" && requirement.typedPredicate.form === "external_evidence" && !requirement.typedPredicate.standardRef) diagnostics.push(diagnostic(requirement, "EXTERNAL_STANDARD_VERSION_SCOPE_MISSING", "error", "External compliance demand lacks a pinned standard/version/scope reference.", ["standardRef"]));
    const metadata = candidateMetadata.get(requirement.requirementId);
    if (metadata?.ambiguityNotes.length) diagnostics.push(diagnostic(requirement, "EXTRACTION_AMBIGUITY", "warning", metadata.ambiguityNotes.join(" ")));
    if (metadata?.missingFields.length) diagnostics.push(diagnostic(requirement, "REQUIRED_FIELD_MISSING", "error", `The extraction explicitly reports missing fields: ${metadata.missingFields.join(", ")}.`, metadata.missingFields));
  }
  const bySemantic = new Map<string, Requirement[]>();
  for (const requirement of requirements) {
    const key = requirementsDigest({ domain: requirement.domain, kind: requirement.kind, subject: [...requirement.subjectRefsOrRoles].sort(), predicate: requirement.typedPredicate, condition: requirement.applicabilityCondition });
    bySemantic.set(key, [...(bySemantic.get(key) ?? []), requirement]);
  }
  for (const group of bySemantic.values()) if (group.length > 1) {
    const ids = group.map((item) => item.requirementId).sort();
    diagnostics.push({ diagnosticId: requirementsId("reqdiag", { code: "SEMANTIC_DUPLICATE", ids }), code: "SEMANTIC_DUPLICATE", severity: "warning", requirementIds: ids, sourceRefs: group.flatMap((item) => item.originalSourceRefs), message: "Multiple sources express the same typed requirement. Preserve the sources and review explicit merge lineage.", missingFields: [], nextActions: ["Merge with source-preserving lineage", "Keep separate when authority or conditions differ"] });
  }
  return diagnostics.sort((left, right) => left.code.localeCompare(right.code) || left.diagnosticId.localeCompare(right.diagnosticId));
}

interface Interval { min?: ConstraintQuantity; max?: ConstraintQuantity; minInclusive: boolean; maxInclusive: boolean }
function asQuantity(value: ConstraintScalar): ConstraintQuantity | undefined { return typeof value === "object" && value !== null && "dimension" in value ? value : undefined; }
function interval(predicate: RequirementPredicate): Interval | undefined {
  if (predicate.form === "minimum") return { min: predicate.value, minInclusive: true, maxInclusive: true };
  if (predicate.form === "maximum") return { max: predicate.value, minInclusive: true, maxInclusive: true };
  if (predicate.form === "range") return { min: predicate.min, max: predicate.max, minInclusive: predicate.minInclusive, maxInclusive: predicate.maxInclusive };
  if (predicate.form === "equals") { const value = asQuantity(predicate.value); return value ? { min: value, max: value, minInclusive: true, maxInclusive: true } : undefined; }
  return undefined;
}

function sameScope(left: Requirement, right: Requirement): boolean {
  if (left.domain !== right.domain) return false;
  const leftSubjects = [...left.subjectRefsOrRoles].sort(); const rightSubjects = [...right.subjectRefsOrRoles].sort();
  if (requirementsDigest(leftSubjects) !== requirementsDigest(rightSubjects)) return false;
  return requirementsDigest(left.applicabilityCondition) === requirementsDigest(right.applicabilityCondition);
}

function conflict(input: Omit<RequirementConflict, "conflictId" | "status">): RequirementConflict {
  return { ...input, conflictId: requirementsId("reqconflict", input), status: "open" };
}

export function detectRequirementConflicts(requirements: readonly Requirement[]): RequirementConflict[] {
  const conflicts: RequirementConflict[] = [];
  const active = requirements.filter((item) => item.status !== "rejected" && item.status !== "superseded");
  for (let leftIndex = 0; leftIndex < active.length; leftIndex++) for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex++) {
    const left = active[leftIndex]; const right = active[rightIndex]; if (!sameScope(left, right)) continue;
    const ids = [left.requirementId, right.requirementId].sort();
    const a = interval(left.typedPredicate); const b = interval(right.typedPredicate);
    if (a && b) {
      try {
        if ((a.min && b.max && (compareQuantities(a.min, b.max) > 0 || (compareQuantities(a.min, b.max) === 0 && (!a.minInclusive || !b.maxInclusive)))) || (b.min && a.max && (compareQuantities(b.min, a.max) > 0 || (compareQuantities(b.min, a.max) === 0 && (!b.minInclusive || !a.maxInclusive))))) {
          conflicts.push(conflict({ conflictKind: "empty_numeric_range", involvedRequirementIds: ids, involvedAssumptionOrDefaultIds: [], capabilityProfileRefs: [], normalizedValues: [a.min ? quantityKey(a.min) : "-inf", a.max ? quantityKey(a.max) : "+inf", b.min ? quantityKey(b.min) : "-inf", b.max ? quantityKey(b.max) : "+inf"], conditions: [left.applicabilityCondition, right.applicabilityCondition], minimalConflictSet: ids, severity: left.status === "confirmed" && right.status === "confirmed" && [left.strength, right.strength].some((value) => value === "hard" || value === "externally_mandated") ? "blocking" : "warning", explanation: "The normalized numeric intervals have an empty intersection under the same scope and condition.", allowedResolutionActions: ["clarify", "split_condition", "change_requirement", "mark_unsupported"] }));
        }
      } catch { /* incompatible dimensions are reported by validation, not hidden as a conflict */ }
    }
    if (left.typedPredicate.form === "equals" && right.typedPredicate.form === "equals" && requirementsDigest(left.typedPredicate.value) !== requirementsDigest(right.typedPredicate.value)) conflicts.push(conflict({ conflictKind: "direct_predicate_contradiction", involvedRequirementIds: ids, involvedAssumptionOrDefaultIds: [], capabilityProfileRefs: [], normalizedValues: [requirementsDigest(left.typedPredicate.value), requirementsDigest(right.typedPredicate.value)], conditions: [left.applicabilityCondition, right.applicabilityCondition], minimalConflictSet: ids, severity: left.status === "confirmed" && right.status === "confirmed" ? "blocking" : "warning", explanation: "The same subject and condition require different exact values.", allowedResolutionActions: ["clarify", "split_condition", "change_requirement"] }));
    const allowed = left.typedPredicate.form === "allowed_set" ? left.typedPredicate : right.typedPredicate.form === "allowed_set" ? right.typedPredicate : undefined;
    const forbidden = left.typedPredicate.form === "forbidden_set" ? left.typedPredicate : right.typedPredicate.form === "forbidden_set" ? right.typedPredicate : undefined;
    if (allowed && forbidden) {
      const permitted = allowed.values.filter((value) => !forbidden.values.some((other) => requirementsDigest(value) === requirementsDigest(other)));
      if (!permitted.length) conflicts.push(conflict({ conflictKind: "allowed_forbidden_set", involvedRequirementIds: ids, involvedAssumptionOrDefaultIds: [], capabilityProfileRefs: [], normalizedValues: [...allowed.values, ...forbidden.values].map(requirementsDigest).sort(), conditions: [left.applicabilityCondition, right.applicabilityCondition], minimalConflictSet: ids, severity: "blocking", explanation: "Every allowed value is forbidden under the same condition.", allowedResolutionActions: ["clarify", "split_condition", "change_requirement"] }));
    }
  }
  for (const requirement of active) if (requirement.capabilityAssessment.state === "unsupported") conflicts.push(conflict({ conflictKind: "capability_limit", involvedRequirementIds: [requirement.requirementId], involvedAssumptionOrDefaultIds: [], capabilityProfileRefs: [requirement.capabilityAssessment.profileRef], normalizedValues: [requirement.capabilityAssessment.capabilityId ?? "unassessed"], conditions: [requirement.applicabilityCondition], minimalConflictSet: [requirement.requirementId], severity: requirement.status === "confirmed" && (requirement.strength === "hard" || requirement.strength === "externally_mandated") ? "blocking" : "warning", explanation: requirement.capabilityAssessment.explanation, allowedResolutionActions: ["clarify", "choose_external_review", "mark_unsupported", "change_requirement"] }));
  return conflicts.sort((left, right) => left.conflictId.localeCompare(right.conflictId));
}
