import type {
  ConstraintCompilationInput,
  ConstraintDefinition,
  ConstraintDocument,
  ConstraintQuantity,
  ConstraintTarget,
  TypedRequirement,
} from "../types";

export const quantity = (dimension: ConstraintQuantity["dimension"], value: string, unit: string): ConstraintQuantity => ({ dimension, value, unit });

export function definition(input: Partial<ConstraintDefinition> & { id: string; kind: ConstraintDefinition["kind"]; requirement: TypedRequirement }): ConstraintDefinition {
  return {
    id: input.id,
    revision: input.revision ?? 1,
    name: input.name ?? input.id,
    domain: input.domain ?? "manufacturing",
    kind: input.kind,
    scope: input.scope ?? { type: "project", id: "project:fixture" },
    selector: input.selector ?? { objectType: "net", predicate: { kind: "ids", ids: ["net:gnd"] }, cardinality: { kind: "exactly", count: 1 } },
    condition: input.condition,
    requirement: input.requirement,
    strength: input.strength ?? "hard",
    severityPolicyId: input.severityPolicyId ?? "severity:blocking",
    origin: input.origin ?? { kind: "project", sourceId: "source:fixture", sourceRevision: "1" },
    evidenceIds: input.evidenceIds ?? [],
    lifecycle: input.lifecycle ?? { state: "active" },
    waiverPolicy: input.waiverPolicy ?? { eligible: false },
    lineage: input.lineage,
  };
}

export function document(constraints: ConstraintDefinition[], overrides: Partial<ConstraintDocument> = {}): ConstraintDocument {
  return {
    schemaVersion: 1,
    id: overrides.id ?? "constraint-set:fixture",
    revision: overrides.revision ?? 1,
    name: overrides.name ?? "Fixture constraints",
    extendsSetIds: overrides.extendsSetIds ?? [],
    constraints,
    relationships: overrides.relationships ?? [],
  };
}

export const targets: ConstraintTarget[] = [
  { id: "project:fixture", type: "project", revision: "p1", name: "Fixture", parentIds: [], tags: [], attributes: {} },
  { id: "net:gnd", type: "net", revision: "n1", name: "GND", parentIds: ["project:fixture", "net-class:power"], tags: ["ground"], attributes: { numericNetId: "1", classId: "Power" } },
  { id: "net:usb-p", type: "net", revision: "n2", name: "USB_D+", parentIds: ["project:fixture"], tags: ["usb"], attributes: { numericNetId: "2" } },
  { id: "net:usb-n", type: "net", revision: "n3", name: "USB_D-", parentIds: ["project:fixture"], tags: ["usb"], attributes: { numericNetId: "3" } },
  { id: "layer:top", type: "layer", revision: "l1", name: "F.Cu", parentIds: ["project:fixture"], tags: ["signal"], attributes: {} },
  { id: "layer:bottom", type: "layer", revision: "l2", name: "B.Cu", parentIds: ["project:fixture"], tags: ["signal"], attributes: {} },
];

export function compilationInput(documents: ConstraintDocument[]): ConstraintCompilationInput {
  return {
    documents,
    targets,
    facts: [],
    designRevision: "design:1",
    catalogRevision: "catalog:1",
    variantRevision: "variant:default:1",
    manufacturingProfileRevision: "fab:fixture:1",
    supportRegistry: {},
  };
}

