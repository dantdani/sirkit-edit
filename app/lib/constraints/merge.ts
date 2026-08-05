import type {
  ConstraintConflict,
  ConstraintDefinition,
  ConstraintKind,
  ConstraintQuantity,
  ConstraintScalar,
  ConstraintStrength,
  EffectiveConstraintRule,
  TruthValue,
  TypedRequirement,
} from "./types";
import { compareQuantities, quantityKey } from "./quantity";
import { canonicalConstraintJson, stableConstraintId } from "./stable";

export interface MergeCandidate {
  definition: ConstraintDefinition;
  targetId: string;
  conditionState: TruthValue;
}

export interface MergeResult {
  rules: EffectiveConstraintRule[];
  conflicts: ConstraintConflict[];
}

function scalarKey(value: ConstraintScalar): string {
  return typeof value === "object" && "dimension" in value ? quantityKey(value) : canonicalConstraintJson(value);
}

function requirementKey(value: TypedRequirement): string {
  return canonicalConstraintJson(value);
}

function conflict(input: {
  code: string;
  targetId: string;
  kind: ConstraintKind;
  candidates: MergeCandidate[];
  explanation: string;
}): ConstraintConflict {
  const sorted = [...input.candidates].sort((a, b) => a.definition.id.localeCompare(b.definition.id));
  const constraintIds = sorted.map((item) => item.definition.id);
  const normalizedValues = sorted.map((item) => requirementKey(item.definition.requirement));
  return {
    id: stableConstraintId("constraint-conflict", { ...input, candidates: constraintIds, normalizedValues }),
    code: input.code,
    targetId: input.targetId,
    kind: input.kind,
    constraintIds,
    normalizedValues,
    explanation: input.explanation,
    nextActions: ["Tighten or remove the incompatible source rule, change the selected profile, or use an explicitly authorized replacement where the rule kind permits it."],
  };
}

function rule(input: {
  targetId: string;
  kind: ConstraintKind;
  strength: ConstraintStrength;
  requirement: TypedRequirement;
  candidates: MergeCandidate[];
  operation: string;
}): EffectiveConstraintRule {
  const candidates = [...input.candidates].sort((a, b) => a.definition.id.localeCompare(b.definition.id));
  const constraintIds = candidates.map((item) => item.definition.id);
  return {
    id: stableConstraintId("effective-rule", { targetId: input.targetId, kind: input.kind, strength: input.strength, requirement: input.requirement, constraintIds }),
    targetId: input.targetId,
    kind: input.kind,
    domain: candidates[0].definition.domain,
    strength: input.strength,
    requirement: input.requirement,
    contributingConstraintIds: constraintIds,
    mergeSteps: [{ operation: input.operation, constraintIds, result: requirementKey(input.requirement) }],
    conditionStates: Object.fromEntries(candidates.map((item) => [item.definition.id, item.conditionState])),
    waiverEligible: candidates.every((item) => item.definition.waiverPolicy.eligible),
    waiverPolicyIds: [...new Set(candidates.map((item) => item.definition.waiverPolicy.authorizationPolicyId).filter((id): id is string => Boolean(id)))].sort(),
    evidenceIds: [...new Set(candidates.flatMap((item) => item.definition.evidenceIds))].sort(),
  };
}

function sameDimension(values: ConstraintQuantity[]): boolean {
  return values.every((value) => value.dimension === values[0]?.dimension);
}

function restrictiveNumeric(candidates: MergeCandidate[]): MergeResult | null {
  if (!candidates.every((item) => ["minimum", "maximum", "range"].includes(item.definition.requirement.form))) return null;
  const lower: Array<{ value: ConstraintQuantity; inclusive: boolean; candidate: MergeCandidate }> = [];
  const upper: Array<{ value: ConstraintQuantity; inclusive: boolean; candidate: MergeCandidate }> = [];
  for (const candidate of candidates) {
    const requirement = candidate.definition.requirement;
    if (requirement.form === "minimum") lower.push({ value: requirement.value, inclusive: true, candidate });
    else if (requirement.form === "maximum") upper.push({ value: requirement.value, inclusive: true, candidate });
    else if (requirement.form === "range") {
      lower.push({ value: requirement.min, inclusive: requirement.minInclusive, candidate });
      upper.push({ value: requirement.max, inclusive: requirement.maxInclusive, candidate });
    }
  }
  const values = [...lower, ...upper].map((item) => item.value);
  if (!sameDimension(values)) {
    return { rules: [], conflicts: [conflict({ code: "UNIT_DIMENSION_CONFLICT", targetId: candidates[0].targetId, kind: candidates[0].definition.kind, candidates, explanation: "Hard numeric constraints use incompatible physical dimensions." })] };
  }
  lower.sort((a, b) => compareQuantities(b.value, a.value) || Number(a.inclusive) - Number(b.inclusive) || a.candidate.definition.id.localeCompare(b.candidate.definition.id));
  upper.sort((a, b) => compareQuantities(a.value, b.value) || Number(a.inclusive) - Number(b.inclusive) || a.candidate.definition.id.localeCompare(b.candidate.definition.id));
  const min = lower[0];
  const max = upper[0];
  if (min && max) {
    const order = compareQuantities(min.value, max.value);
    if (order > 0 || (order === 0 && (!min.inclusive || !max.inclusive))) {
      return { rules: [], conflicts: [conflict({
        code: "EMPTY_NUMERIC_FEASIBLE_RANGE",
        targetId: candidates[0].targetId,
        kind: candidates[0].definition.kind,
        candidates: [min.candidate, max.candidate],
        explanation: `The most restrictive lower bound ${quantityKey(min.value)} exceeds or excludes the upper bound ${quantityKey(max.value)}.`,
      })] };
    }
  }
  const requirement: TypedRequirement = min && max
    ? { form: "range", min: min.value, max: max.value, minInclusive: min.inclusive, maxInclusive: max.inclusive }
    : min
      ? { form: "minimum", value: min.value }
      : { form: "maximum", value: max!.value };
  return { rules: [rule({ targetId: candidates[0].targetId, kind: candidates[0].definition.kind, strength: "hard", requirement, candidates, operation: "restrictive numeric intersection" })], conflicts: [] };
}

function setMerge(candidates: MergeCandidate[]): MergeResult | null {
  const forms = new Set(candidates.map((item) => item.definition.requirement.form));
  if (forms.size !== 1 || !["allowed_set", "forbidden_set", "required_set"].includes([...forms][0])) return null;
  const form = [...forms][0] as "allowed_set" | "forbidden_set" | "required_set";
  const entries = candidates.map((candidate) => {
    const requirement = candidate.definition.requirement as Extract<TypedRequirement, { form: typeof form }>;
    return { candidate, byKey: new Map(requirement.values.map((value) => [scalarKey(value), value])) };
  });
  let keys = new Set(entries[0].byKey.keys());
  if (form === "allowed_set") {
    for (const entry of entries.slice(1)) keys = new Set([...keys].filter((key) => entry.byKey.has(key)));
  } else for (const entry of entries.slice(1)) for (const key of entry.byKey.keys()) keys.add(key);
  if (form === "allowed_set" && keys.size === 0) {
    let running = new Set(entries[0].byKey.keys());
    const minimal = [entries[0].candidate];
    for (const entry of entries.slice(1)) {
      running = new Set([...running].filter((key) => entry.byKey.has(key)));
      minimal.push(entry.candidate);
      if (running.size === 0) break;
    }
    return { rules: [], conflicts: [conflict({ code: "EMPTY_ALLOWED_SET", targetId: candidates[0].targetId, kind: candidates[0].definition.kind, candidates: minimal, explanation: "The intersection of hard allowed sets is empty." })] };
  }
  const allValues = new Map(entries.flatMap((entry) => [...entry.byKey.entries()]));
  const values = [...keys].sort().map((key) => allValues.get(key)!);
  return { rules: [rule({ targetId: candidates[0].targetId, kind: candidates[0].definition.kind, strength: "hard", requirement: { form, values }, candidates, operation: form === "allowed_set" ? "set intersection" : "set union" })], conflicts: [] };
}

function equalityMerge(candidates: MergeCandidate[]): MergeResult | null {
  if (!candidates.every((item) => item.definition.requirement.form === "equals")) return null;
  const keys = new Map(candidates.map((item) => [scalarKey((item.definition.requirement as Extract<TypedRequirement, { form: "equals" }>).value), item]));
  if (keys.size > 1) return { rules: [], conflicts: [conflict({ code: "INCOMPATIBLE_EQUALITIES", targetId: candidates[0].targetId, kind: candidates[0].definition.kind, candidates: [...keys.values()], explanation: "Hard equality constraints require different values and no authorized replacement resolved them." })] };
  const requirement = candidates[0].definition.requirement;
  return { rules: [rule({ targetId: candidates[0].targetId, kind: candidates[0].definition.kind, strength: "hard", requirement, candidates, operation: "equality agreement" })], conflicts: [] };
}

function budgetMerge(candidates: MergeCandidate[]): MergeResult | null {
  if (!candidates.every((item) => item.definition.requirement.form === "budget")) return null;
  const requirements = candidates.map((item) => item.definition.requirement as Extract<TypedRequirement, { form: "budget" }>);
  if (!requirements.every((item) => item.aggregate === requirements[0].aggregate)) {
    return { rules: [], conflicts: [conflict({ code: "INCOMPATIBLE_BUDGET_AGGREGATES", targetId: candidates[0].targetId, kind: candidates[0].definition.kind, candidates, explanation: "Budget constraints use incompatible aggregate definitions." })] };
  }
  const sorted = candidates.map((candidate) => ({ candidate, requirement: candidate.definition.requirement as Extract<TypedRequirement, { form: "budget" }> })).sort((left, right) => {
    const a = left.requirement.limit;
    const b = right.requirement.limit;
    if ("dimension" in a && "dimension" in b) return compareQuantities(a, b);
    if ("kind" in a && "kind" in b) return Number(a.value) - Number(b.value);
    return canonicalConstraintJson(a).localeCompare(canonicalConstraintJson(b));
  });
  return { rules: [rule({ targetId: candidates[0].targetId, kind: candidates[0].definition.kind, strength: "hard", requirement: sorted[0].requirement, candidates, operation: "most restrictive budget" })], conflicts: [] };
}

const ACCUMULATING_FORMS = new Set(["must_connect", "must_not_connect", "distance", "containment", "ordering", "target", "must_exist", "require_coverage"]);

function mergeHard(candidates: MergeCandidate[]): MergeResult {
  const numeric = restrictiveNumeric(candidates);
  if (numeric) return numeric;
  const sets = setMerge(candidates);
  if (sets) return sets;
  const equalities = equalityMerge(candidates);
  if (equalities) return equalities;
  const budget = budgetMerge(candidates);
  if (budget) return budget;
  if (candidates.every((item) => item.definition.requirement.form === "not_equals")) {
    const values = [...new Map(candidates.map((item) => {
      const value = (item.definition.requirement as Extract<TypedRequirement, { form: "not_equals" }>).value;
      return [scalarKey(value), value];
    })).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
    return { rules: [rule({ targetId: candidates[0].targetId, kind: candidates[0].definition.kind, strength: "hard", requirement: { form: "forbidden_set", values }, candidates, operation: "prohibition union" })], conflicts: [] };
  }
  if (candidates.every((item) => ACCUMULATING_FORMS.has(item.definition.requirement.form))) {
    const unique = new Map(candidates.map((item) => [requirementKey(item.definition.requirement), item]));
    return {
      rules: [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, candidate]) => rule({
        targetId: candidate.targetId,
        kind: candidate.definition.kind,
        strength: "hard",
        requirement: candidate.definition.requirement,
        candidates: candidates.filter((item) => requirementKey(item.definition.requirement) === requirementKey(candidate.definition.requirement)),
        operation: "relational accumulation",
      })),
      conflicts: [],
    };
  }
  if (candidates.length === 1) return { rules: [rule({ targetId: candidates[0].targetId, kind: candidates[0].definition.kind, strength: "hard", requirement: candidates[0].definition.requirement, candidates, operation: "single hard requirement" })], conflicts: [] };
  return { rules: [], conflicts: [conflict({ code: "INCOMPATIBLE_REQUIREMENT_FORMS", targetId: candidates[0].targetId, kind: candidates[0].definition.kind, candidates, explanation: "This combination of hard requirement forms has no defined safe merge algebra." })] };
}

export function mergeConstraintCandidates(candidates: MergeCandidate[]): MergeResult {
  const rules: EffectiveConstraintRule[] = [];
  const conflicts: ConstraintConflict[] = [];
  const groups = new Map<string, MergeCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.targetId}\0${candidate.definition.kind}\0${candidate.definition.strength}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  for (const [, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    group.sort((a, b) => a.definition.id.localeCompare(b.definition.id));
    if (group[0].definition.strength === "hard") {
      const result = mergeHard(group);
      rules.push(...result.rules);
      conflicts.push(...result.conflicts);
    } else {
      for (const candidate of group) rules.push(rule({
        targetId: candidate.targetId,
        kind: candidate.definition.kind,
        strength: candidate.definition.strength,
        requirement: candidate.definition.requirement,
        candidates: [candidate],
        operation: candidate.definition.strength === "soft" ? "preserved soft objective" : "non-enforcing declaration",
      }));
    }
  }
  return { rules: rules.sort((a, b) => a.id.localeCompare(b.id)), conflicts: conflicts.sort((a, b) => a.id.localeCompare(b.id)) };
}
