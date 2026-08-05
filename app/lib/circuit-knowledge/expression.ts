import { canonicalUnit, compareQuantities, normalizeQuantity, normalizedDecimalText, validateQuantity } from "../constraints/quantity";
import type { ConstraintQuantity, QuantityDimension } from "../constraints/types";
import type { CircuitKnowledgeCapabilityProfile, RecipeExpression, RecipeParameterDefinition } from "./types";

export type RecipeExpressionValue = ConstraintQuantity | boolean | string;
export type RecipeExpressionType = QuantityDimension | "boolean" | "enum" | "integer" | "unknown";
export interface RecipeExpressionResult { state: "value" | "unknown" | "error" | "resource_limit"; value?: RecipeExpressionValue; valueType: RecipeExpressionType; nodeCount: number; diagnostics: string[]; }

export function countRecipeExpressionNodes(expression: RecipeExpression): number {
  switch (expression.kind) {
    case "unary": return 1 + countRecipeExpressionNodes(expression.operand);
    case "binary": return 1 + countRecipeExpressionNodes(expression.left) + countRecipeExpressionNodes(expression.right);
    case "function": return 1 + expression.arguments.reduce((sum, item) => sum + countRecipeExpressionNodes(item), 0);
    case "conditional": return 1 + countRecipeExpressionNodes(expression.condition) + countRecipeExpressionNodes(expression.whenTrue) + countRecipeExpressionNodes(expression.whenFalse);
    default: return 1;
  }
}

function isQuantity(value: RecipeExpressionValue | undefined): value is ConstraintQuantity {
  return !!value && typeof value === "object" && "dimension" in value && "unit" in value && "value" in value;
}

function quantityNumber(value: ConstraintQuantity): number {
  const normalized = normalizeQuantity(value);
  if (normalized.digits.length > 15) throw new Error("EXPRESSION_PRECISION_LIMIT_EXCEEDED");
  const number = Number(normalizedDecimalText(normalized));
  if (!Number.isFinite(number)) throw new Error("EXPRESSION_NUMBER_OUT_OF_RANGE");
  return number;
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) throw new Error("EXPRESSION_NONFINITE_RESULT");
  const text = value.toString();
  if (/e/i.test(text)) throw new Error("EXPRESSION_RESULT_REQUIRES_UNSUPPORTED_PRECISION");
  return text;
}

function quantityResult(dimension: QuantityDimension, value: number): ConstraintQuantity {
  return { dimension, unit: canonicalUnit(dimension), value: numberText(value) };
}

function typesEqual(left: RecipeExpressionType, right: RecipeExpressionType): boolean {
  return left === right || (left === "integer" && right === "dimensionless") || (right === "integer" && left === "dimensionless");
}

export function inferRecipeExpressionType(expression: RecipeExpression, parameters: Map<string, RecipeParameterDefinition>): RecipeExpressionType {
  switch (expression.kind) {
    case "quantity": return validateQuantity(expression.value).length ? "unknown" : expression.value.dimension;
    case "boolean": return "boolean";
    case "enum": return "enum";
    case "parameter_ref": return parameters.get(expression.parameterId)?.quantityType ?? "unknown";
    case "unary": {
      const operand = inferRecipeExpressionType(expression.operand, parameters);
      if (expression.operator === "not") return operand === "boolean" ? "boolean" : "unknown";
      return !["boolean", "enum", "unknown"].includes(operand) ? operand : "unknown";
    }
    case "binary": {
      const left = inferRecipeExpressionType(expression.left, parameters);
      const right = inferRecipeExpressionType(expression.right, parameters);
      if (["and", "or"].includes(expression.operator)) return left === "boolean" && right === "boolean" ? "boolean" : "unknown";
      if (["lt", "lte", "gt", "gte", "eq"].includes(expression.operator)) return typesEqual(left, right) ? "boolean" : "unknown";
      if (["add", "subtract"].includes(expression.operator)) return typesEqual(left, right) ? left : "unknown";
      if (expression.operator === "multiply") return left === "dimensionless" || left === "integer" ? right : right === "dimensionless" || right === "integer" ? left : "unknown";
      if (expression.operator === "divide") return right === "dimensionless" || right === "integer" ? left : typesEqual(left, right) ? "dimensionless" : "unknown";
      return "unknown";
    }
    case "function": {
      const types = expression.arguments.map((item) => inferRecipeExpressionType(item, parameters));
      if ((expression.functionId === "clamp" && types.length !== 3) || (["min", "max"].includes(expression.functionId) && types.length < 1)) return "unknown";
      return types.every((item) => typesEqual(types[0], item)) ? types[0] : "unknown";
    }
    case "conditional": {
      const condition = inferRecipeExpressionType(expression.condition, parameters);
      const whenTrue = inferRecipeExpressionType(expression.whenTrue, parameters);
      const whenFalse = inferRecipeExpressionType(expression.whenFalse, parameters);
      return condition === "boolean" && typesEqual(whenTrue, whenFalse) ? whenTrue : "unknown";
    }
  }
}

function evaluateInternal(expression: RecipeExpression, bindings: ReadonlyMap<string, RecipeExpressionValue>): RecipeExpressionValue | undefined {
  switch (expression.kind) {
    case "quantity": return structuredClone(expression.value);
    case "boolean": return expression.value;
    case "enum": return expression.value;
    case "parameter_ref": return bindings.get(expression.parameterId);
    case "unary": {
      const operand = evaluateInternal(expression.operand, bindings);
      if (operand === undefined) return undefined;
      if (expression.operator === "not") { if (typeof operand !== "boolean") throw new Error("EXPRESSION_NOT_REQUIRES_BOOLEAN"); return !operand; }
      if (!isQuantity(operand)) throw new Error("EXPRESSION_NEGATE_REQUIRES_QUANTITY");
      return quantityResult(operand.dimension, -quantityNumber(operand));
    }
    case "binary": {
      const left = evaluateInternal(expression.left, bindings);
      const right = evaluateInternal(expression.right, bindings);
      if (left === undefined || right === undefined) return undefined;
      if (expression.operator === "and" || expression.operator === "or") {
        if (typeof left !== "boolean" || typeof right !== "boolean") throw new Error("EXPRESSION_LOGIC_REQUIRES_BOOLEAN");
        return expression.operator === "and" ? left && right : left || right;
      }
      if (expression.operator === "eq") {
        if (isQuantity(left) && isQuantity(right)) return compareQuantities(left, right) === 0;
        if (typeof left !== typeof right) throw new Error("EXPRESSION_EQ_TYPE_MISMATCH");
        return left === right;
      }
      if (["lt", "lte", "gt", "gte"].includes(expression.operator)) {
        if (!isQuantity(left) || !isQuantity(right)) throw new Error("EXPRESSION_COMPARE_REQUIRES_QUANTITY");
        const compared = compareQuantities(left, right);
        return expression.operator === "lt" ? compared < 0 : expression.operator === "lte" ? compared <= 0 : expression.operator === "gt" ? compared > 0 : compared >= 0;
      }
      if (!isQuantity(left) || !isQuantity(right)) throw new Error("EXPRESSION_ARITHMETIC_REQUIRES_QUANTITY");
      const a = quantityNumber(left); const b = quantityNumber(right);
      if (["add", "subtract"].includes(expression.operator)) {
        if (left.dimension !== right.dimension) throw new Error("EXPRESSION_DIMENSION_MISMATCH");
        return quantityResult(left.dimension, expression.operator === "add" ? a + b : a - b);
      }
      if (expression.operator === "multiply") {
        if (left.dimension !== "dimensionless" && right.dimension !== "dimensionless") throw new Error("EXPRESSION_COMPOUND_UNIT_REQUIRES_REGISTERED_ADAPTER");
        return quantityResult(left.dimension === "dimensionless" ? right.dimension : left.dimension, a * b);
      }
      if (b === 0) throw new Error("EXPRESSION_DIVIDE_BY_ZERO");
      if (right.dimension === "dimensionless") return quantityResult(left.dimension, a / b);
      if (left.dimension === right.dimension) return quantityResult("dimensionless", a / b);
      throw new Error("EXPRESSION_COMPOUND_UNIT_REQUIRES_REGISTERED_ADAPTER");
    }
    case "function": {
      const values = expression.arguments.map((item) => evaluateInternal(item, bindings));
      if (values.some((item) => item === undefined)) return undefined;
      if (!values.every(isQuantity)) throw new Error("EXPRESSION_FUNCTION_REQUIRES_QUANTITIES");
      if (values.some((item) => item.dimension !== values[0].dimension)) throw new Error("EXPRESSION_DIMENSION_MISMATCH");
      const numbers = values.map(quantityNumber);
      if (expression.functionId === "clamp") return quantityResult(values[0].dimension, Math.min(numbers[2], Math.max(numbers[1], numbers[0])));
      return quantityResult(values[0].dimension, expression.functionId === "min" ? Math.min(...numbers) : Math.max(...numbers));
    }
    case "conditional": {
      const condition = evaluateInternal(expression.condition, bindings);
      if (condition === undefined) {
        if (expression.unknownPolicy === "block") throw new Error("EXPRESSION_CONDITION_UNKNOWN_BLOCKING");
        return undefined;
      }
      if (typeof condition !== "boolean") throw new Error("EXPRESSION_CONDITION_REQUIRES_BOOLEAN");
      return evaluateInternal(condition ? expression.whenTrue : expression.whenFalse, bindings);
    }
  }
}

export function evaluateRecipeExpression(input: {
  expression: RecipeExpression;
  parameterDefinitions: RecipeParameterDefinition[];
  bindings?: ReadonlyMap<string, RecipeExpressionValue>;
  capabilityProfile: CircuitKnowledgeCapabilityProfile;
}): RecipeExpressionResult {
  const nodeCount = countRecipeExpressionNodes(input.expression);
  const parameters = new Map(input.parameterDefinitions.map((item) => [item.parameterId, item]));
  const valueType = inferRecipeExpressionType(input.expression, parameters);
  if (nodeCount > input.capabilityProfile.limits.maximumExpressionNodes) return { state: "resource_limit", valueType, nodeCount, diagnostics: ["EXPRESSION_NODE_LIMIT_EXCEEDED"] };
  if (valueType === "unknown") return { state: "error", valueType, nodeCount, diagnostics: ["EXPRESSION_STATIC_TYPE_INVALID"] };
  try {
    const value = evaluateInternal(input.expression, input.bindings ?? new Map());
    return value === undefined ? { state: "unknown", valueType, nodeCount, diagnostics: ["EXPRESSION_INPUT_UNKNOWN"] } : { state: "value", value, valueType, nodeCount, diagnostics: [] };
  } catch (error) {
    return { state: "error", valueType, nodeCount, diagnostics: [error instanceof Error ? error.message : "EXPRESSION_EVALUATION_FAILED"] };
  }
}

/** A deliberately independent dimensional oracle used by the corpus tests. */
export function oracleExpressionDimension(expression: RecipeExpression, parameterTypes: ReadonlyMap<string, RecipeExpressionType>): RecipeExpressionType {
  const definitions = new Map<string, RecipeParameterDefinition>();
  for (const [parameterId, quantityType] of parameterTypes) definitions.set(parameterId, { parameterId, semanticRole: parameterId, quantityType: quantityType === "unknown" ? "dimensionless" : quantityType, unitPolicy: [], valueState: "unknown", sourceBindingKinds: [], conditions: [], requiredForStages: [], defaultPolicy: "none", uncertaintyPolicy: "unknown", evidenceRefs: [] });
  return inferRecipeExpressionType(expression, definitions);
}
