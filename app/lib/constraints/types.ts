/**
 * Stage 6 canonical constraint contract.
 *
 * These types are deliberately JSON-only. A compiled program can be embedded
 * in a project, hashed, inspected offline, and passed to every consumer without
 * executable callbacks or provider-specific objects.
 */

export const CONSTRAINT_SCHEMA_VERSION = 1 as const;
export const CONSTRAINT_COMPILER_VERSION = "sirkit-constraints/1.0.0" as const;
export const CONSTRAINT_MERGE_POLICY_VERSION = "restrictive-algebra/1.0.0" as const;

export type ConstraintDomain =
  | "component"
  | "sourcing"
  | "schematic"
  | "application"
  | "manufacturing"
  | "pcb_geometry"
  | "routing"
  | "placement"
  | "release";

export type ConstraintStrength = "hard" | "soft" | "advisory" | "assumption";
export type ConstraintLifecycleState = "draft" | "active" | "deprecated" | "superseded" | "revoked";
export type ConstraintEvaluationState =
  | "pass"
  | "fail"
  | "unknown"
  | "unsupported"
  | "not_run"
  | "not_applicable"
  | "stale";
export type TruthValue = "true" | "false" | "unknown";

export type ConstraintObjectType =
  | "organization"
  | "catalog"
  | "manufacturing_profile"
  | "project"
  | "variant"
  | "sheet"
  | "block"
  | "atomic_part"
  | "component"
  | "terminal"
  | "pin"
  | "pad"
  | "rail"
  | "net"
  | "net_class"
  | "interface"
  | "bus"
  | "differential_pair"
  | "board"
  | "layer"
  | "region"
  | "keepout"
  | "footprint"
  | "track"
  | "via"
  | "zone"
  | "plane"
  | "hole"
  | "diagnostic";

export type ConstraintKind =
  | "component_category"
  | "approved_part"
  | "forbidden_part"
  | "package_restriction"
  | "qualification"
  | "source_freshness"
  | "voltage_operating_range"
  | "voltage_absolute_maximum"
  | "current_budget"
  | "terminal_connection"
  | "decoupling"
  | "exposed_pad_connection"
  | "dnc_connection"
  | "programming_access"
  | "trace_width"
  | "clearance"
  | "same_net_feature"
  | "via_diameter"
  | "via_drill"
  | "annular_ring"
  | "hole_clearance"
  | "edge_clearance"
  | "mask_clearance"
  | "paste_rule"
  | "silk_clearance"
  | "courtyard_clearance"
  | "allowed_layers"
  | "forbidden_layers"
  | "preferred_layers"
  | "via_type"
  | "via_span"
  | "via_count"
  | "zone_connection"
  | "zone_thermal_gap"
  | "zone_thermal_spokes"
  | "zone_island_area"
  | "keepout"
  | "differential_pair"
  | "target_impedance"
  | "route_length"
  | "pair_skew"
  | "bus_match"
  | "topology"
  | "return_reference"
  | "placement_fixed"
  | "placement_side"
  | "placement_orientation"
  | "placement_region"
  | "placement_proximity"
  | "placement_separation"
  | "placement_group"
  | "critical_loop"
  | "thermal_relation"
  | "test_access"
  | "require_checker";

export type QuantityDimension =
  | "dimensionless"
  | "voltage"
  | "current"
  | "resistance"
  | "impedance"
  | "capacitance"
  | "inductance"
  | "power"
  | "energy"
  | "charge"
  | "frequency"
  | "time"
  | "temperature"
  | "length"
  | "mass";

/** Decimal text is parsed exactly; scientific notation and NaN/Infinity are forbidden. */
export interface ConstraintQuantity {
  dimension: QuantityDimension;
  value: string;
  unit: string;
}

export interface IntegerValue {
  kind: "integer";
  value: string;
}

export type ConstraintScalar = ConstraintQuantity | IntegerValue | string | boolean;

export type CardinalityExpectation =
  | { kind: "zero_or_more" }
  | { kind: "exactly"; count: number }
  | { kind: "at_least"; count: number }
  | { kind: "at_most"; count: number }
  | { kind: "exactly_two_ordered" }
  | { kind: "one_per_member"; relationshipId: string };

export type SelectorPredicate =
  | { kind: "all" }
  | { kind: "ids"; ids: string[] }
  | { kind: "member_of"; parentType: ConstraintObjectType; parentId: string }
  | { kind: "tag"; tag: string }
  | { kind: "attribute"; field: string; operator: "eq" | "neq" | "contains" | "one_of"; value: string | boolean | string[] }
  | { kind: "name_glob"; pattern: string }
  | { kind: "all_of"; predicates: SelectorPredicate[] }
  | { kind: "any_of"; predicates: SelectorPredicate[] };

export interface TypedSelector {
  objectType: ConstraintObjectType;
  predicate: SelectorPredicate;
  cardinality: CardinalityExpectation;
}

export type ConditionExpression =
  | { kind: "literal"; value: TruthValue }
  | { kind: "fact_truth"; factId: string }
  | { kind: "fact_equals"; factId: string; value: ConstraintScalar }
  | { kind: "fact_compare"; factId: string; operator: "lt" | "lte" | "gt" | "gte"; value: ConstraintQuantity }
  | { kind: "not"; expression: ConditionExpression }
  | { kind: "and"; expressions: ConditionExpression[] }
  | { kind: "or"; expressions: ConditionExpression[] };

export type TypedRequirement =
  | { form: "minimum"; value: ConstraintQuantity }
  | { form: "maximum"; value: ConstraintQuantity }
  | { form: "range"; min: ConstraintQuantity; max: ConstraintQuantity; minInclusive: boolean; maxInclusive: boolean }
  | { form: "equals"; value: ConstraintScalar }
  | { form: "not_equals"; value: ConstraintScalar }
  | { form: "allowed_set"; values: ConstraintScalar[] }
  | { form: "forbidden_set"; values: ConstraintScalar[] }
  | { form: "required_set"; values: ConstraintScalar[] }
  | { form: "must_exist"; cardinality: CardinalityExpectation }
  | { form: "must_connect"; relationshipId: string }
  | { form: "must_not_connect"; relationshipId: string }
  | { form: "distance"; relation: "minimum" | "maximum"; value: ConstraintQuantity; referenceIds: string[] }
  | { form: "containment"; regionIds: string[]; mode: "inside" | "outside" }
  | { form: "ordering"; orderedTargetIds: string[] }
  | { form: "budget"; aggregate: "sum" | "count"; limit: ConstraintQuantity | IntegerValue; margin?: ConstraintQuantity }
  | { form: "target"; value: ConstraintQuantity; toleranceMinus: ConstraintQuantity; tolerancePlus: ConstraintQuantity }
  | { form: "objective"; direction: "minimize" | "maximize"; metric: string; weight: string }
  | { form: "require_coverage"; checkerId: string; minimumSupport: "enforced" | "compiled_for_consumer" };

export interface ConstraintOrigin {
  kind:
    | "organization_policy"
    | "manufacturing_profile"
    | "project"
    | "legacy_import"
    | "kicad_import"
    | "stage5_guidance"
    | "deterministic_inference"
    | "ai_proposal"
    | "user";
  sourceId: string;
  sourceRevision: string;
  actorId?: string;
  confidence?: number;
  reviewState?: "proposed" | "approved" | "rejected";
}

export interface ConstraintDefinition {
  id: string;
  revision: number;
  name: string;
  description?: string;
  domain: ConstraintDomain;
  kind: ConstraintKind;
  scope: { type: ConstraintObjectType; id?: string; path?: string };
  selector: TypedSelector;
  condition?: ConditionExpression;
  requirement: TypedRequirement;
  strength: ConstraintStrength;
  severityPolicyId: string;
  origin: ConstraintOrigin;
  evidenceIds: string[];
  lifecycle: { state: ConstraintLifecycleState; supersedesRevisionId?: string };
  waiverPolicy: { eligible: boolean; authorizationPolicyId?: string; reason?: string };
  lineage?: {
    extendsSetIds?: string[];
    refinesConstraintIds?: string[];
    replacesConstraintIds?: string[];
    derivedFromIds?: string[];
  };
  sourceLocation?: { sourceId: string; line?: number; column?: number; path?: string };
}

export type RelationshipKind =
  | "rail_membership"
  | "decoupling"
  | "differential_pair"
  | "bus_membership"
  | "current_loop"
  | "placement_group"
  | "aggressor_victim"
  | "return_reference"
  | "connector_edge"
  | "test_point_coverage"
  | "termination";

export interface ConstraintRelationship {
  id: string;
  revision: number;
  kind: RelationshipKind;
  members: Array<{ role: string; targetType: ConstraintObjectType; targetId: string; order?: number }>;
  origin: ConstraintOrigin;
  evidenceIds: string[];
  lifecycle: ConstraintLifecycleState;
}

export interface ConstraintDocument {
  schemaVersion: typeof CONSTRAINT_SCHEMA_VERSION;
  id: string;
  revision: number;
  name: string;
  description?: string;
  extendsSetIds: string[];
  constraints: ConstraintDefinition[];
  relationships: ConstraintRelationship[];
}

export interface ConstraintTarget {
  id: string;
  type: ConstraintObjectType;
  revision: string;
  name?: string;
  parentIds: string[];
  tags: string[];
  attributes: Record<string, string | boolean | string[]>;
}

export interface ConstraintFact {
  id: string;
  value: ConstraintScalar | null;
  state: "known" | "unknown" | "conflicting" | "stale";
  evidenceIds: string[];
}

export interface SelectorSnapshot {
  constraintId: string;
  selector: TypedSelector;
  targetIds: string[];
  targetSetHash: string;
  designRevision: string;
  state: "resolved" | "empty" | "ambiguous" | "unresolved";
  reasons: Record<string, string>;
}

export interface ConstraintDiagnostic {
  id: string;
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  constraintIds: string[];
  targetIds: string[];
  sourceLocations: Array<{ sourceId: string; line?: number; column?: number; path?: string }>;
  nextActions: string[];
}

export interface ConstraintConflict {
  id: string;
  code: string;
  targetId: string;
  kind: ConstraintKind;
  constraintIds: string[];
  normalizedValues: string[];
  explanation: string;
  nextActions: string[];
}

export interface EffectiveConstraintRule {
  id: string;
  targetId: string;
  kind: ConstraintKind;
  domain: ConstraintDomain;
  strength: ConstraintStrength;
  requirement: TypedRequirement;
  contributingConstraintIds: string[];
  mergeSteps: Array<{ operation: string; constraintIds: string[]; result: string }>;
  conditionStates: Record<string, TruthValue>;
  waiverEligible: boolean;
  waiverPolicyIds: string[];
  evidenceIds: string[];
}

export type EnforcementSupport =
  | "enforced"
  | "compiled_for_consumer"
  | "declarative_only"
  | "unsupported"
  | "not_applicable"
  | "unknown"
  | "stale";

export interface EnforcementCoverage {
  constraintId: string;
  targetIds: string[];
  consumerId: string;
  checkerVersion: string;
  support: EnforcementSupport;
  requiredInputs: string[];
  readinessImpact: "blocking_failure" | "verification_incomplete" | "advisory" | "none";
  laterStage?: 7 | 8 | 9 | 10;
}

export interface LoweredPhysicalRule {
  targetId: string;
  minTrackWidthNm?: number;
  maxTrackWidthNm?: number;
  clearanceNm?: number;
  minViaOuterNm?: number;
  minViaDrillNm?: number;
  minAnnularRingNm?: number;
  minHoleToHoleNm?: number;
  minEdgeClearanceNm?: number;
  minSilkPadClearanceNm?: number;
  minCourtyardClearanceNm?: number;
  allowedLayerIds?: string[];
  forbiddenLayerIds?: string[];
  preferredLayerIds?: string[];
  allowedViaTypes?: string[];
  allowedViaSpans?: string[];
  maxViaCount?: number;
  constraintIds: string[];
  programHash: string;
}

export interface LoweredRelationshipRule {
  relationshipId: string;
  kind: RelationshipKind;
  memberIds: string[];
  constraintIds: string[];
  support: EnforcementSupport;
}

export interface ConstraintLowerings {
  physicalByTarget: Record<string, LoweredPhysicalRule>;
  schematicRules: EffectiveConstraintRule[];
  componentSelectionRules: EffectiveConstraintRule[];
  routingGraph: LoweredRelationshipRule[];
  placementGraph: LoweredRelationshipRule[];
  readinessConstraintIds: string[];
  kicadConstraintIds: string[];
}

export interface ConstraintProgram {
  schemaVersion: 1;
  compilerVersion: typeof CONSTRAINT_COMPILER_VERSION;
  mergePolicyVersion: typeof CONSTRAINT_MERGE_POLICY_VERSION;
  programHash: string;
  sourceSetRevisions: Array<{ id: string; revision: number }>;
  designRevision: string;
  catalogRevision: string;
  variantRevision: string;
  manufacturingProfileRevision: string;
  targetSnapshots: SelectorSnapshot[];
  relationshipIds: string[];
  activeConstraintIds: string[];
  effectiveRules: EffectiveConstraintRule[];
  conflicts: ConstraintConflict[];
  diagnostics: ConstraintDiagnostic[];
  coverage: EnforcementCoverage[];
  lowerings: ConstraintLowerings;
}

export interface ConstraintCompilationInput {
  documents: ConstraintDocument[];
  targets: ConstraintTarget[];
  facts: ConstraintFact[];
  designRevision: string;
  catalogRevision: string;
  variantRevision: string;
  manufacturingProfileRevision: string;
  supportRegistry: Partial<Record<ConstraintKind, Omit<EnforcementCoverage, "constraintId" | "targetIds" | "readinessImpact">>>;
}

export type ConstraintCompilationResult =
  | { ok: true; program: ConstraintProgram; diagnostics: ConstraintDiagnostic[] }
  | {
      ok: false;
      candidateHash: string;
      diagnostics: ConstraintDiagnostic[];
      conflicts: ConstraintConflict[];
      targetSnapshots: SelectorSnapshot[];
    };

export interface ConstraintViolation {
  id: string;
  constraintId: string;
  targetIds: string[];
  state: ConstraintEvaluationState;
  consumerId: string;
  checkerVersion: string;
  actual?: ConstraintScalar;
  required?: TypedRequirement;
  evidenceIds: string[];
  message: string;
  nextAction: string;
}

export interface ConstraintWaiver {
  schemaVersion: 1;
  id: string;
  constraintIds: string[];
  violationIds: string[];
  targetIds: string[];
  designRevision: string;
  programHash: string;
  releaseProfileId: string;
  reason: string;
  actorId: string;
  authorizedBy: string;
  createdAt: string;
  expiresAt?: string;
  invalidation: "any_semantic_change";
}

export interface ConstraintEvaluationReport {
  schemaVersion: 1;
  programHash: string;
  designRevision: string;
  evaluationHash: string;
  states: Array<{
    constraintId: string;
    targetIds: string[];
    state: ConstraintEvaluationState;
    consumerId: string;
    violationIds: string[];
  }>;
  violations: ConstraintViolation[];
  waivers: ConstraintWaiver[];
  readinessState: "satisfied" | "blocked" | "verification_incomplete" | "stale";
}

export interface BoardConstraintState {
  schemaVersion: 1;
  /** Project identity used to compile target ids and the design revision. */
  projectId?: string;
  documents: ConstraintDocument[];
  activeProgram?: ConstraintProgram;
  activeEvaluation?: ConstraintEvaluationReport;
  waivers: ConstraintWaiver[];
  legacyMigration: { version: 1; sourceHash: string };
  history: Array<{
    id: string;
    action: "activate" | "revert";
    fromProgramHash?: string;
    toProgramHash: string;
    actorId: string;
    programSnapshot?: ConstraintProgram;
    documentSnapshot?: ConstraintDocument[];
  }>;
}
