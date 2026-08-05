import type {
  CardinalityExpectation,
  ConstraintDiagnostic,
  ConstraintRelationship,
  ConstraintTarget,
  SelectorPredicate,
  SelectorSnapshot,
  TypedSelector,
} from "./types";
import { constraintSemanticHash, stableConstraintId } from "./stable";

function globMatches(pattern: string, value: string): boolean {
  if (pattern.length > 128 || !/^[A-Za-z0-9 _.:+\-*/?]+$/.test(pattern)) return false;
  let source = "^";
  for (const char of pattern) {
    if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "iu").test(value);
}

function attributeMatches(target: ConstraintTarget, predicate: Extract<SelectorPredicate, { kind: "attribute" }>): boolean {
  const actual = target.attributes[predicate.field];
  if (predicate.operator === "eq") return actual === predicate.value;
  if (predicate.operator === "neq") return actual !== predicate.value;
  if (predicate.operator === "contains") return Array.isArray(actual) && typeof predicate.value === "string" && actual.includes(predicate.value);
  const expected = Array.isArray(predicate.value) ? predicate.value : [String(predicate.value)];
  return typeof actual === "string" ? expected.includes(actual) : Array.isArray(actual) && actual.some((item) => expected.includes(item));
}

function matches(target: ConstraintTarget, predicate: SelectorPredicate): boolean {
  switch (predicate.kind) {
    case "all": return true;
    case "ids": return predicate.ids.includes(target.id);
    case "member_of": return target.parentIds.includes(predicate.parentId);
    case "tag": return target.tags.includes(predicate.tag);
    case "attribute": return attributeMatches(target, predicate);
    case "name_glob": return globMatches(predicate.pattern, target.name ?? "");
    case "all_of": return predicate.predicates.every((child) => matches(target, child));
    case "any_of": return predicate.predicates.some((child) => matches(target, child));
  }
}

function expectedCount(cardinality: CardinalityExpectation, relationships: ConstraintRelationship[]): { min: number; max: number } {
  switch (cardinality.kind) {
    case "zero_or_more": return { min: 0, max: Number.MAX_SAFE_INTEGER };
    case "exactly": return { min: cardinality.count, max: cardinality.count };
    case "at_least": return { min: cardinality.count, max: Number.MAX_SAFE_INTEGER };
    case "at_most": return { min: 0, max: cardinality.count };
    case "exactly_two_ordered": return { min: 2, max: 2 };
    case "one_per_member": {
      const count = relationships.find((item) => item.id === cardinality.relationshipId)?.members.length ?? -1;
      return count < 0 ? { min: Number.MAX_SAFE_INTEGER, max: -1 } : { min: count, max: count };
    }
  }
}

export function resolveSelector(input: {
  constraintId: string;
  selector: TypedSelector;
  targets: ConstraintTarget[];
  relationships: ConstraintRelationship[];
  designRevision: string;
}): { snapshot: SelectorSnapshot; diagnostics: ConstraintDiagnostic[] } {
  const candidates = input.targets
    .filter((target) => target.type === input.selector.objectType)
    .filter((target) => matches(target, input.selector.predicate))
    .sort((left, right) => left.id.localeCompare(right.id));
  const targetIds = candidates.map((target) => target.id);
  const expected = expectedCount(input.selector.cardinality, input.relationships);
  const countMatches = targetIds.length >= expected.min && targetIds.length <= expected.max;
  const unresolvedIds = input.selector.predicate.kind === "ids"
    ? input.selector.predicate.ids.filter((id) => !input.targets.some((target) => target.id === id))
    : [];
  const state: SelectorSnapshot["state"] = unresolvedIds.length > 0
    ? "unresolved"
    : countMatches
      ? "resolved"
      : targetIds.length < expected.min
        ? "empty"
        : "ambiguous";
  const reasons = Object.fromEntries(candidates.map((target) => [target.id, `Matched ${input.selector.predicate.kind} selector as stable ${target.type} ${target.id}.`]));
  const snapshot: SelectorSnapshot = {
    constraintId: input.constraintId,
    selector: input.selector,
    targetIds,
    targetSetHash: constraintSemanticHash({ selector: input.selector, targetIds }),
    designRevision: input.designRevision,
    state,
    reasons,
  };
  const diagnostics: ConstraintDiagnostic[] = [];
  if (state !== "resolved") {
    const code = state === "empty" ? "SELECTOR_CARDINALITY_EMPTY" : state === "ambiguous" ? "SELECTOR_CARDINALITY_AMBIGUOUS" : "SELECTOR_ID_UNRESOLVED";
    const message = state === "unresolved"
      ? `Selector for ${input.constraintId} references missing stable IDs: ${unresolvedIds.sort().join(", ")}.`
      : `Selector for ${input.constraintId} resolved ${targetIds.length} target(s); expected ${expected.min}${expected.max === expected.min ? "" : `..${expected.max === Number.MAX_SAFE_INTEGER ? "many" : expected.max}`}.`;
    diagnostics.push({
      id: stableConstraintId("constraint-diagnostic", { code, constraintId: input.constraintId, targetIds, expected }),
      code,
      severity: "error",
      message,
      constraintIds: [input.constraintId],
      targetIds,
      sourceLocations: [],
      nextActions: ["Correct the stable selector or its explicit cardinality before activation."],
    });
  }
  return { snapshot, diagnostics };
}

export function validateRelationships(relationships: ConstraintRelationship[], targets: ConstraintTarget[]): ConstraintDiagnostic[] {
  const targetIds = new Set(targets.map((target) => target.id));
  const diagnostics: ConstraintDiagnostic[] = [];
  for (const relationship of [...relationships].sort((a, b) => a.id.localeCompare(b.id))) {
    const memberKeys = relationship.members.map((member) => `${member.role}\0${member.targetId}`);
    const missing = relationship.members.filter((member) => !targetIds.has(member.targetId)).map((member) => member.targetId).sort();
    const duplicate = memberKeys.filter((key, index) => memberKeys.indexOf(key) !== index);
    const pairRoles = relationship.kind === "differential_pair"
      ? relationship.members.map((member) => member.role).sort().join("\0")
      : null;
    if (missing.length > 0 || duplicate.length > 0 || (pairRoles !== null && pairRoles !== "negative\0positive")) {
      const code = missing.length > 0 ? "RELATIONSHIP_TARGET_MISSING" : duplicate.length > 0 ? "RELATIONSHIP_MEMBER_DUPLICATE" : "DIFFERENTIAL_PAIR_POLARITY_INVALID";
      diagnostics.push({
        id: stableConstraintId("constraint-diagnostic", { code, relationshipId: relationship.id, missing, duplicate, pairRoles }),
        code,
        severity: "error",
        message: missing.length > 0
          ? `Relationship ${relationship.id} references missing targets: ${missing.join(", ")}.`
          : duplicate.length > 0
            ? `Relationship ${relationship.id} repeats a role/target member.`
            : `Differential pair ${relationship.id} requires exactly one positive and one negative member.`,
        constraintIds: [],
        targetIds: relationship.members.map((member) => member.targetId).sort(),
        sourceLocations: [],
        nextActions: ["Repair the relationship using exact stable members and recompile."],
      });
    }
  }
  return diagnostics;
}

