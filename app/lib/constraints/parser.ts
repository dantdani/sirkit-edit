import {
  CONSTRAINT_SCHEMA_VERSION,
  type CardinalityExpectation,
  type ConditionExpression,
  type ConstraintDefinition,
  type ConstraintDiagnostic,
  type ConstraintDocument,
  type ConstraintQuantity,
  type ConstraintRelationship,
  type SelectorPredicate,
  type TypedRequirement,
  type TypedSelector,
} from "./types";
import { canonicalConstraintJson, stableConstraintId } from "./stable";
import { validateQuantity } from "./quantity";

export const CONSTRAINT_INPUT_LIMITS = {
  maxBytes: 1_000_000,
  maxDepth: 40,
  maxNodes: 50_000,
  maxConstraints: 2_000,
  maxRelationships: 2_000,
  maxArrayItems: 5_000,
  maxStringLength: 20_000,
  maxSelectorDepth: 16,
} as const;

export type ParseConstraintResult =
  | { ok: true; document: ConstraintDocument; diagnostics: ConstraintDiagnostic[] }
  | { ok: false; diagnostics: ConstraintDiagnostic[] };

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function diagnostic(code: string, message: string, path = "$", constraintIds: string[] = []): ConstraintDiagnostic {
  return {
    id: stableConstraintId("constraint-diagnostic", { code, message, path, constraintIds }),
    code,
    severity: "error",
    message,
    constraintIds,
    targetIds: [],
    sourceLocations: [{ sourceId: "constraint-document", path }],
    nextActions: ["Correct the typed constraint document and compile the complete candidate again."],
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function walkLimits(value: unknown): string[] {
  const errors: string[] = [];
  let nodes = 0;
  const visit = (child: unknown, depth: number, path: string): void => {
    nodes += 1;
    if (nodes > CONSTRAINT_INPUT_LIMITS.maxNodes) {
      errors.push(`Document exceeds ${CONSTRAINT_INPUT_LIMITS.maxNodes} nodes.`);
      return;
    }
    if (depth > CONSTRAINT_INPUT_LIMITS.maxDepth) {
      errors.push(`${path} exceeds maximum nesting depth ${CONSTRAINT_INPUT_LIMITS.maxDepth}.`);
      return;
    }
    if (typeof child === "string" && child.length > CONSTRAINT_INPUT_LIMITS.maxStringLength) {
      errors.push(`${path} exceeds maximum string length ${CONSTRAINT_INPUT_LIMITS.maxStringLength}.`);
    } else if (Array.isArray(child)) {
      if (child.length > CONSTRAINT_INPUT_LIMITS.maxArrayItems) errors.push(`${path} contains too many array items.`);
      child.forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`));
    } else if (object(child)) {
      for (const [key, item] of Object.entries(child)) {
        if (FORBIDDEN_KEYS.has(key)) errors.push(`${path}.${key} is a forbidden object key.`);
        visit(item, depth + 1, `${path}.${key}`);
      }
    }
  };
  visit(value, 0, "$");
  return [...new Set(errors)].sort();
}

function requireId(value: unknown, path: string, errors: ConstraintDiagnostic[]): value is string {
  if (typeof value !== "string" || !ID.test(value)) {
    errors.push(diagnostic("INVALID_STABLE_ID", `${path} must be a bounded stable ID.`, path));
    return false;
  }
  return true;
}

function validateQuantityAt(value: unknown, path: string, errors: ConstraintDiagnostic[]): value is ConstraintQuantity {
  if (!object(value) || typeof value.dimension !== "string" || typeof value.value !== "string" || typeof value.unit !== "string") {
    errors.push(diagnostic("INVALID_QUANTITY", `${path} must contain dimension, decimal-text value, and unit.`, path));
    return false;
  }
  for (const message of validateQuantity(value as unknown as ConstraintQuantity)) {
    errors.push(diagnostic("INVALID_QUANTITY", `${path}: ${message}`, path));
  }
  return true;
}

function validateCardinality(value: unknown, path: string, errors: ConstraintDiagnostic[]): value is CardinalityExpectation {
  if (!object(value) || typeof value.kind !== "string") {
    errors.push(diagnostic("INVALID_CARDINALITY", `${path} must be a typed cardinality.`, path));
    return false;
  }
  if (["exactly", "at_least", "at_most"].includes(value.kind)) {
    if (!Number.isSafeInteger(value.count) || (value.count as number) < 0) errors.push(diagnostic("INVALID_CARDINALITY", `${path}.count must be a non-negative integer.`, path));
  } else if (value.kind === "one_per_member") {
    requireId(value.relationshipId, `${path}.relationshipId`, errors);
  } else if (!["zero_or_more", "exactly_two_ordered"].includes(value.kind)) {
    errors.push(diagnostic("INVALID_CARDINALITY", `${path}.kind '${value.kind}' is unsupported.`, path));
  }
  return true;
}

function validatePredicate(value: unknown, path: string, errors: ConstraintDiagnostic[], depth = 0): value is SelectorPredicate {
  if (depth > CONSTRAINT_INPUT_LIMITS.maxSelectorDepth) {
    errors.push(diagnostic("SELECTOR_DEPTH_LIMIT", `${path} exceeds selector depth ${CONSTRAINT_INPUT_LIMITS.maxSelectorDepth}.`, path));
    return false;
  }
  if (!object(value) || typeof value.kind !== "string") {
    errors.push(diagnostic("INVALID_SELECTOR", `${path} must be a typed selector predicate.`, path));
    return false;
  }
  if (value.kind === "ids") {
    if (!Array.isArray(value.ids) || value.ids.length === 0) errors.push(diagnostic("INVALID_SELECTOR", `${path}.ids must not be empty.`, path));
    else value.ids.forEach((id, index) => requireId(id, `${path}.ids[${index}]`, errors));
  } else if (value.kind === "member_of") {
    requireId(value.parentId, `${path}.parentId`, errors);
    if (typeof value.parentType !== "string") errors.push(diagnostic("INVALID_SELECTOR", `${path}.parentType is required.`, path));
  } else if (value.kind === "tag") {
    if (typeof value.tag !== "string" || value.tag.length > 128) errors.push(diagnostic("INVALID_SELECTOR", `${path}.tag must be a bounded string.`, path));
  } else if (value.kind === "attribute") {
    if (typeof value.field !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.field)) errors.push(diagnostic("INVALID_SELECTOR", `${path}.field is invalid.`, path));
    if (!["eq", "neq", "contains", "one_of"].includes(String(value.operator))) errors.push(diagnostic("INVALID_SELECTOR", `${path}.operator is unsupported.`, path));
  } else if (value.kind === "name_glob") {
    if (typeof value.pattern !== "string" || value.pattern.length > 128 || !/^[A-Za-z0-9 _.:+\-*/?]+$/.test(value.pattern)) {
      errors.push(diagnostic("UNSAFE_NAME_PATTERN", `${path}.pattern must be a bounded glob, not an arbitrary regular expression.`, path));
    }
  } else if (value.kind === "all_of" || value.kind === "any_of") {
    if (!Array.isArray(value.predicates) || value.predicates.length === 0 || value.predicates.length > 32) {
      errors.push(diagnostic("INVALID_SELECTOR", `${path}.predicates must contain 1..32 entries.`, path));
    } else value.predicates.forEach((predicate, index) => validatePredicate(predicate, `${path}.predicates[${index}]`, errors, depth + 1));
  } else if (value.kind !== "all") {
    errors.push(diagnostic("INVALID_SELECTOR", `${path}.kind '${value.kind}' is unsupported.`, path));
  }
  return true;
}

function validateSelector(value: unknown, path: string, errors: ConstraintDiagnostic[]): value is TypedSelector {
  if (!object(value) || typeof value.objectType !== "string") {
    errors.push(diagnostic("INVALID_SELECTOR", `${path} must name an objectType.`, path));
    return false;
  }
  validatePredicate(value.predicate, `${path}.predicate`, errors);
  validateCardinality(value.cardinality, `${path}.cardinality`, errors);
  return true;
}

function validateScalar(value: unknown, path: string, errors: ConstraintDiagnostic[]): void {
  if (typeof value === "string" || typeof value === "boolean") return;
  if (object(value) && value.kind === "integer" && typeof value.value === "string" && /^-?(?:0|[1-9]\d*)$/.test(value.value)) return;
  validateQuantityAt(value, path, errors);
}

function validateRequirement(value: unknown, path: string, errors: ConstraintDiagnostic[]): value is TypedRequirement {
  if (!object(value) || typeof value.form !== "string") {
    errors.push(diagnostic("INVALID_REQUIREMENT", `${path} must be a typed requirement.`, path));
    return false;
  }
  if (value.form === "minimum" || value.form === "maximum") validateQuantityAt(value.value, `${path}.value`, errors);
  else if (value.form === "range") {
    validateQuantityAt(value.min, `${path}.min`, errors);
    validateQuantityAt(value.max, `${path}.max`, errors);
    if (typeof value.minInclusive !== "boolean" || typeof value.maxInclusive !== "boolean") errors.push(diagnostic("INVALID_RANGE", `${path} requires explicit inclusivity.`, path));
  } else if (value.form === "equals" || value.form === "not_equals") validateScalar(value.value, `${path}.value`, errors);
  else if (["allowed_set", "forbidden_set", "required_set"].includes(value.form)) {
    if (!Array.isArray(value.values) || value.values.length === 0) errors.push(diagnostic("INVALID_SET", `${path}.values must not be empty.`, path));
    else value.values.forEach((item, index) => validateScalar(item, `${path}.values[${index}]`, errors));
  } else if (value.form === "must_exist") validateCardinality(value.cardinality, `${path}.cardinality`, errors);
  else if (value.form === "must_connect" || value.form === "must_not_connect") requireId(value.relationshipId, `${path}.relationshipId`, errors);
  else if (value.form === "distance") {
    if (!["minimum", "maximum"].includes(String(value.relation))) errors.push(diagnostic("INVALID_DISTANCE", `${path}.relation is invalid.`, path));
    validateQuantityAt(value.value, `${path}.value`, errors);
    if (!Array.isArray(value.referenceIds) || value.referenceIds.length === 0) errors.push(diagnostic("INVALID_DISTANCE", `${path}.referenceIds must not be empty.`, path));
  } else if (value.form === "containment") {
    if (!Array.isArray(value.regionIds) || value.regionIds.length === 0) errors.push(diagnostic("INVALID_CONTAINMENT", `${path}.regionIds must not be empty.`, path));
  } else if (value.form === "ordering") {
    if (!Array.isArray(value.orderedTargetIds) || value.orderedTargetIds.length < 2) errors.push(diagnostic("INVALID_ORDERING", `${path} requires at least two targets.`, path));
  } else if (value.form === "budget") validateScalar(value.limit, `${path}.limit`, errors);
  else if (value.form === "target") {
    validateQuantityAt(value.value, `${path}.value`, errors);
    validateQuantityAt(value.toleranceMinus, `${path}.toleranceMinus`, errors);
    validateQuantityAt(value.tolerancePlus, `${path}.tolerancePlus`, errors);
  } else if (value.form === "objective") {
    if (typeof value.metric !== "string" || typeof value.weight !== "string") errors.push(diagnostic("INVALID_OBJECTIVE", `${path} requires metric and deterministic decimal weight.`, path));
  } else if (value.form === "require_coverage") requireId(value.checkerId, `${path}.checkerId`, errors);
  else errors.push(diagnostic("UNSUPPORTED_REQUIREMENT", `${path}.form '${value.form}' is unsupported.`, path));
  return true;
}

function validateCondition(value: unknown, path: string, errors: ConstraintDiagnostic[], depth = 0): value is ConditionExpression {
  if (depth > 20 || !object(value) || typeof value.kind !== "string") {
    errors.push(diagnostic("INVALID_CONDITION", `${path} is invalid or too deeply nested.`, path));
    return false;
  }
  if (value.kind === "literal") {
    if (!["true", "false", "unknown"].includes(String(value.value))) errors.push(diagnostic("INVALID_CONDITION", `${path}.value is invalid.`, path));
  } else if (value.kind === "fact_truth") requireId(value.factId, `${path}.factId`, errors);
  else if (value.kind === "fact_equals") {
    requireId(value.factId, `${path}.factId`, errors);
    validateScalar(value.value, `${path}.value`, errors);
  } else if (value.kind === "fact_compare") {
    requireId(value.factId, `${path}.factId`, errors);
    if (!["lt", "lte", "gt", "gte"].includes(String(value.operator))) errors.push(diagnostic("INVALID_CONDITION", `${path}.operator is invalid.`, path));
    validateQuantityAt(value.value, `${path}.value`, errors);
  } else if (value.kind === "not") validateCondition(value.expression, `${path}.expression`, errors, depth + 1);
  else if (value.kind === "and" || value.kind === "or") {
    if (!Array.isArray(value.expressions) || value.expressions.length === 0 || value.expressions.length > 32) errors.push(diagnostic("INVALID_CONDITION", `${path}.expressions must contain 1..32 entries.`, path));
    else value.expressions.forEach((item, index) => validateCondition(item, `${path}.expressions[${index}]`, errors, depth + 1));
  } else errors.push(diagnostic("FORBIDDEN_EXPRESSION", `${path}.kind '${value.kind}' is not in the pure expression allowlist.`, path));
  return true;
}

function validateConstraint(value: unknown, path: string, errors: ConstraintDiagnostic[]): value is ConstraintDefinition {
  if (!object(value)) {
    errors.push(diagnostic("INVALID_CONSTRAINT", `${path} must be an object.`, path));
    return false;
  }
  const id = requireId(value.id, `${path}.id`, errors) ? value.id : undefined;
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) errors.push(diagnostic("INVALID_REVISION", `${path}.revision must be a positive integer.`, path, id ? [id] : []));
  for (const field of ["name", "domain", "kind", "strength", "severityPolicyId"] as const) {
    if (typeof value[field] !== "string" || !value[field]) errors.push(diagnostic("MISSING_FIELD", `${path}.${field} is required.`, path, id ? [id] : []));
  }
  validateSelector(value.selector, `${path}.selector`, errors);
  if (value.condition !== undefined) validateCondition(value.condition, `${path}.condition`, errors);
  validateRequirement(value.requirement, `${path}.requirement`, errors);
  if (!object(value.origin) || typeof value.origin.kind !== "string" || !requireId(value.origin.sourceId, `${path}.origin.sourceId`, errors) || typeof value.origin.sourceRevision !== "string") errors.push(diagnostic("INVALID_ORIGIN", `${path}.origin is incomplete.`, path, id ? [id] : []));
  if (!Array.isArray(value.evidenceIds)) errors.push(diagnostic("INVALID_EVIDENCE", `${path}.evidenceIds must be an array.`, path, id ? [id] : []));
  if (!object(value.lifecycle) || typeof value.lifecycle.state !== "string") errors.push(diagnostic("INVALID_LIFECYCLE", `${path}.lifecycle is required.`, path, id ? [id] : []));
  if (!object(value.waiverPolicy) || typeof value.waiverPolicy.eligible !== "boolean") errors.push(diagnostic("INVALID_WAIVER_POLICY", `${path}.waiverPolicy is required and separate from the requirement.`, path, id ? [id] : []));
  return true;
}

function validateRelationship(value: unknown, path: string, errors: ConstraintDiagnostic[]): value is ConstraintRelationship {
  if (!object(value)) {
    errors.push(diagnostic("INVALID_RELATIONSHIP", `${path} must be an object.`, path));
    return false;
  }
  requireId(value.id, `${path}.id`, errors);
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) errors.push(diagnostic("INVALID_REVISION", `${path}.revision must be positive.`, path));
  if (typeof value.kind !== "string" || !Array.isArray(value.members) || value.members.length < 2) errors.push(diagnostic("INVALID_RELATIONSHIP", `${path} needs a kind and at least two stable members.`, path));
  else value.members.forEach((member, index) => {
    if (!object(member)) errors.push(diagnostic("INVALID_RELATIONSHIP_MEMBER", `${path}.members[${index}] must be an object.`, path));
    else {
      requireId(member.targetId, `${path}.members[${index}].targetId`, errors);
      if (typeof member.role !== "string" || typeof member.targetType !== "string") errors.push(diagnostic("INVALID_RELATIONSHIP_MEMBER", `${path}.members[${index}] requires role and targetType.`, path));
    }
  });
  return true;
}

export function parseConstraintDocument(text: string): ParseConstraintResult {
  if (new TextEncoder().encode(text).byteLength > CONSTRAINT_INPUT_LIMITS.maxBytes) {
    return { ok: false, diagnostics: [diagnostic("DOCUMENT_SIZE_LIMIT", `Constraint input exceeds ${CONSTRAINT_INPUT_LIMITS.maxBytes} bytes.`)] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic("INVALID_JSON", error instanceof Error ? error.message : "Invalid JSON document.")] };
  }
  const errors = walkLimits(raw).map((message) => diagnostic("RESOURCE_LIMIT", message));
  if (!object(raw)) errors.push(diagnostic("INVALID_DOCUMENT", "Constraint document must be an object."));
  if (!object(raw)) return { ok: false, diagnostics: errors };
  if (raw.schemaVersion !== CONSTRAINT_SCHEMA_VERSION) errors.push(diagnostic("UNKNOWN_SCHEMA_VERSION", `Expected schemaVersion ${CONSTRAINT_SCHEMA_VERSION}.`, "$.schemaVersion"));
  requireId(raw.id, "$.id", errors);
  if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1) errors.push(diagnostic("INVALID_REVISION", "$.revision must be a positive integer.", "$.revision"));
  if (typeof raw.name !== "string" || !raw.name.trim()) errors.push(diagnostic("MISSING_FIELD", "$.name is required.", "$.name"));
  if (!Array.isArray(raw.extendsSetIds)) errors.push(diagnostic("INVALID_INHERITANCE", "$.extendsSetIds must be an array.", "$.extendsSetIds"));
  if (!Array.isArray(raw.constraints)) errors.push(diagnostic("INVALID_DOCUMENT", "$.constraints must be an array.", "$.constraints"));
  else {
    if (raw.constraints.length > CONSTRAINT_INPUT_LIMITS.maxConstraints) errors.push(diagnostic("CONSTRAINT_COUNT_LIMIT", "Too many constraints.", "$.constraints"));
    raw.constraints.forEach((item, index) => validateConstraint(item, `$.constraints[${index}]`, errors));
  }
  if (!Array.isArray(raw.relationships)) errors.push(diagnostic("INVALID_DOCUMENT", "$.relationships must be an array.", "$.relationships"));
  else {
    if (raw.relationships.length > CONSTRAINT_INPUT_LIMITS.maxRelationships) errors.push(diagnostic("RELATIONSHIP_COUNT_LIMIT", "Too many relationships.", "$.relationships"));
    raw.relationships.forEach((item, index) => validateRelationship(item, `$.relationships[${index}]`, errors));
  }
  const ids = [
    ...(Array.isArray(raw.constraints) ? raw.constraints.filter(object).map((item) => item.id).filter((id): id is string => typeof id === "string") : []),
    ...(Array.isArray(raw.relationships) ? raw.relationships.filter(object).map((item) => item.id).filter((id): id is string => typeof id === "string") : []),
  ];
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const id of [...new Set(duplicateIds)].sort()) errors.push(diagnostic("DUPLICATE_STABLE_ID", `Stable ID '${id}' occurs more than once.`, "$", [id]));
  if (errors.some((item) => item.severity === "error")) return { ok: false, diagnostics: errors.sort((a, b) => a.id.localeCompare(b.id)) };
  return { ok: true, document: raw as unknown as ConstraintDocument, diagnostics: [] };
}

export function canonicalConstraintDocument(document: ConstraintDocument): ConstraintDocument {
  return {
    ...document,
    extendsSetIds: [...new Set(document.extendsSetIds)].sort(),
    constraints: [...document.constraints].map((constraint) => ({
      ...constraint,
      evidenceIds: [...new Set(constraint.evidenceIds)].sort(),
    })).sort((left, right) => left.id.localeCompare(right.id) || left.revision - right.revision),
    relationships: [...document.relationships].map((relationship) => ({
      ...relationship,
      evidenceIds: [...new Set(relationship.evidenceIds)].sort(),
      members: [...relationship.members].sort((left, right) =>
        (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
        left.role.localeCompare(right.role) || left.targetId.localeCompare(right.targetId)),
    })).sort((left, right) => left.id.localeCompare(right.id) || left.revision - right.revision),
  };
}

export function formatConstraintDocument(document: ConstraintDocument): string {
  return `${JSON.stringify(JSON.parse(canonicalConstraintJson(canonicalConstraintDocument(document))) as unknown, null, 2)}\n`;
}

