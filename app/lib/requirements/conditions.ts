import { compareQuantities } from "../constraints/quantity";
import type { ConditionExpression, ConstraintFact, ConstraintScalar, TruthValue } from "../constraints/types";
import { requirementsDigest } from "./stable";

function not(value: TruthValue): TruthValue {
  return value === "unknown" ? "unknown" : value === "true" ? "false" : "true";
}

function and(values: readonly TruthValue[]): TruthValue {
  if (values.includes("false")) return "false";
  return values.includes("unknown") ? "unknown" : "true";
}

function or(values: readonly TruthValue[]): TruthValue {
  if (values.includes("true")) return "true";
  return values.includes("unknown") ? "unknown" : "false";
}

function scalarEqual(left: ConstraintScalar, right: ConstraintScalar): boolean {
  if (typeof left === "object" && left !== null && "dimension" in left && typeof right === "object" && right !== null && "dimension" in right) {
    try { return compareQuantities(left, right) === 0; } catch { return false; }
  }
  return requirementsDigest(left) === requirementsDigest(right);
}

export function evaluateRequirementCondition(expression: ConditionExpression | undefined, facts: readonly ConstraintFact[]): TruthValue {
  if (!expression) return "true";
  if (expression.kind === "literal") return expression.value;
  if (expression.kind === "not") return not(evaluateRequirementCondition(expression.expression, facts));
  if (expression.kind === "and") return and(expression.expressions.map((item) => evaluateRequirementCondition(item, facts)));
  if (expression.kind === "or") return or(expression.expressions.map((item) => evaluateRequirementCondition(item, facts)));
  const fact = facts.find((item) => item.id === expression.factId);
  if (!fact || fact.state !== "known" || fact.value === null) return "unknown";
  if (expression.kind === "fact_truth") return fact.value === true ? "true" : fact.value === false ? "false" : "unknown";
  if (expression.kind === "fact_equals") return scalarEqual(fact.value, expression.value) ? "true" : "false";
  if (typeof fact.value !== "object" || fact.value === null || !("dimension" in fact.value)) return "unknown";
  try {
    const comparison = compareQuantities(fact.value, expression.value);
    const result = expression.operator === "lt" ? comparison < 0 : expression.operator === "lte" ? comparison <= 0 : expression.operator === "gt" ? comparison > 0 : comparison >= 0;
    return result ? "true" : "false";
  } catch { return "unknown"; }
}

export function unknownHardApplicabilityBlocks(value: TruthValue, strength: string): boolean {
  return value === "unknown" && (strength === "hard" || strength === "externally_mandated");
}

