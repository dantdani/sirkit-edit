import type { ConditionExpression, ConstraintFact, ConstraintScalar, TruthValue } from "./types";
import { compareQuantities, quantityKey } from "./quantity";
import { canonicalConstraintJson } from "./stable";

function and(values: TruthValue[]): TruthValue {
  if (values.includes("false")) return "false";
  return values.includes("unknown") ? "unknown" : "true";
}

function or(values: TruthValue[]): TruthValue {
  if (values.includes("true")) return "true";
  return values.includes("unknown") ? "unknown" : "false";
}

function scalarKey(value: ConstraintScalar): string {
  return typeof value === "object" && "dimension" in value ? quantityKey(value) : canonicalConstraintJson(value);
}

export function evaluateCondition(expression: ConditionExpression | undefined, facts: ConstraintFact[]): TruthValue {
  if (!expression) return "true";
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const evaluate = (node: ConditionExpression, depth: number): TruthValue => {
    if (depth > 20) return "unknown";
    if (node.kind === "literal") return node.value;
    if (node.kind === "not") {
      const value = evaluate(node.expression, depth + 1);
      return value === "true" ? "false" : value === "false" ? "true" : "unknown";
    }
    if (node.kind === "and") return and(node.expressions.map((child) => evaluate(child, depth + 1)));
    if (node.kind === "or") return or(node.expressions.map((child) => evaluate(child, depth + 1)));
    const fact = byId.get(node.factId);
    if (!fact || fact.state !== "known" || fact.value === null) return "unknown";
    if (node.kind === "fact_truth") return typeof fact.value === "boolean" ? (fact.value ? "true" : "false") : "unknown";
    if (node.kind === "fact_equals") return scalarKey(fact.value) === scalarKey(node.value) ? "true" : "false";
    if (typeof fact.value !== "object" || !("dimension" in fact.value)) return "unknown";
    try {
      const comparison = compareQuantities(fact.value, node.value);
      const passes = node.operator === "lt" ? comparison < 0 : node.operator === "lte" ? comparison <= 0 : node.operator === "gt" ? comparison > 0 : comparison >= 0;
      return passes ? "true" : "false";
    } catch {
      return "unknown";
    }
  };
  return evaluate(expression, 0);
}

