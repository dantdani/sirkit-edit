import {
  CONSTRAINT_COMPILER_VERSION,
  CONSTRAINT_MERGE_POLICY_VERSION,
  type ConstraintCompilationInput,
  type ConstraintCompilationResult,
  type ConstraintDefinition,
  type ConstraintDiagnostic,
  type ConstraintKind,
  type ConstraintLowerings,
  type ConstraintProgram,
  type EffectiveConstraintRule,
  type EnforcementCoverage,
  type EnforcementSupport,
  type LoweredPhysicalRule,
  type LoweredRelationshipRule,
} from "./types";
import { canonicalConstraintDocument, parseConstraintDocument } from "./parser";
import { evaluateCondition } from "./expressions";
import { mergeConstraintCandidates, type MergeCandidate } from "./merge";
import { quantityToInteger } from "./quantity";
import { constraintSemanticHash, deepFreezeConstraint, stableConstraintId } from "./stable";
import { resolveSelector, validateRelationships } from "./selectors";

const PHYSICAL_KIND_FIELD: Partial<Record<ConstraintKind, keyof LoweredPhysicalRule>> = {
  trace_width: "minTrackWidthNm",
  clearance: "clearanceNm",
  via_diameter: "minViaOuterNm",
  via_drill: "minViaDrillNm",
  annular_ring: "minAnnularRingNm",
  hole_clearance: "minHoleToHoleNm",
  edge_clearance: "minEdgeClearanceNm",
  silk_clearance: "minSilkPadClearanceNm",
  courtyard_clearance: "minCourtyardClearanceNm",
  allowed_layers: "allowedLayerIds",
  forbidden_layers: "forbiddenLayerIds",
  preferred_layers: "preferredLayerIds",
  via_type: "allowedViaTypes",
  via_span: "allowedViaSpans",
  via_count: "maxViaCount",
};

const DEFAULT_SUPPORT: Partial<Record<ConstraintKind, { consumerId: string; checkerVersion: string; support: EnforcementSupport; requiredInputs: string[]; laterStage?: 7 | 8 }>> = {
  trace_width: { consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["pcb-geometry"] },
  clearance: { consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["pcb-geometry"] },
  via_diameter: { consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["pcb-geometry"] },
  via_drill: { consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["pcb-geometry"] },
  annular_ring: { consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["pcb-geometry"] },
  edge_clearance: { consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["board-outline"] },
  // R06 follow-up: these three ARE deterministically measured by the DRC engine
  // (checkHoleToHole #6, checkCourtyardOverlap #8, checkSilkOverPad #9); they
  // were never registered here, so every manufacturing program carrying them
  // reported "unsupported" and readiness could never reach "ready".
  hole_clearance: { consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["pcb-geometry"] },
  courtyard_clearance: { consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["pcb-geometry", "courtyard-geometry"] },
  silk_clearance: { consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["pcb-geometry", "silkscreen-geometry"] },
  allowed_layers: { consumerId: "post-route-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["stackup", "routing"] },
  forbidden_layers: { consumerId: "post-route-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["stackup", "routing"] },
  preferred_layers: { consumerId: "routing-rule-graph", checkerVersion: "stage6/1", support: "compiled_for_consumer", requiredInputs: ["stackup"] },
  via_type: { consumerId: "post-route-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["stackup", "via-library", "routing"] },
  via_span: { consumerId: "post-route-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["stackup", "via-library", "routing"] },
  via_count: { consumerId: "post-route-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["routing"] },
  terminal_connection: { consumerId: "application-erc", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["electrical-truth"] },
  dnc_connection: { consumerId: "application-erc", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["electrical-truth", "atomic-terminal"] },
  exposed_pad_connection: { consumerId: "application-erc", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["electrical-truth", "atomic-terminal"] },
  voltage_operating_range: { consumerId: "application-erc", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["atomic-claims", "electrical-truth"] },
  current_budget: { consumerId: "application-erc", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["atomic-claims", "rail-relationship"] },
  decoupling: { consumerId: "application-erc", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["atomic-guidance", "electrical-truth"] },
  target_impedance: { consumerId: "signal-integrity-solver", checkerVersion: "unavailable", support: "unsupported", requiredInputs: ["validated-stackup-materials", "field-solver"], laterStage: 8 },
  differential_pair: { consumerId: "routing-rule-graph", checkerVersion: "stage6/1", support: "compiled_for_consumer", requiredInputs: ["routing"], laterStage: 8 },
  route_length: { consumerId: "post-route-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["routing"] },
  pair_skew: { consumerId: "post-route-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["routing", "differential-pair"] },
  bus_match: { consumerId: "post-route-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["routing", "bus"] },
  placement_fixed: { consumerId: "placement-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["placement"] },
  placement_side: { consumerId: "placement-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["placement"] },
  placement_orientation: { consumerId: "placement-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["placement"] },
  placement_region: { consumerId: "placement-static-checker", checkerVersion: "stage6/1", support: "enforced", requiredInputs: ["placement", "region"] },
  placement_proximity: { consumerId: "engineering-placement-hard-validator", checkerVersion: "stage7/1", support: "enforced", requiredInputs: ["placement", "reference-geometry"] },
  placement_separation: { consumerId: "engineering-placement-hard-validator", checkerVersion: "stage7/1", support: "enforced", requiredInputs: ["placement", "reference-geometry"] },
  critical_loop: { consumerId: "placement-constraint-graph", checkerVersion: "stage6/1", support: "compiled_for_consumer", requiredInputs: ["placement", "routing"], laterStage: 7 },
};

function diagnostic(code: string, message: string, constraintIds: string[] = [], targetIds: string[] = [], severity: ConstraintDiagnostic["severity"] = "error"): ConstraintDiagnostic {
  return {
    id: stableConstraintId("constraint-diagnostic", { code, message, constraintIds, targetIds }),
    code,
    severity,
    message,
    constraintIds: [...constraintIds].sort(),
    targetIds: [...targetIds].sort(),
    sourceLocations: [],
    nextActions: [severity === "error" ? "Resolve this compilation issue before activating the candidate." : "Review the unresolved engineering constraint and supply the required data or checker."],
  };
}

function inheritanceDiagnostics(documents: ConstraintCompilationInput["documents"]): ConstraintDiagnostic[] {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const diagnostics: ConstraintDiagnostic[] = [];
  for (const document of documents) for (const parent of document.extendsSetIds) if (!byId.has(parent)) diagnostics.push(diagnostic("CONSTRAINT_SET_PARENT_MISSING", `${document.id} extends missing set ${parent}.`));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id];
      diagnostics.push(diagnostic("CONSTRAINT_SET_INHERITANCE_CYCLE", `Constraint-set inheritance cycle: ${cycle.join(" -> ")}.`));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of byId.get(id)?.extendsSetIds ?? []) visit(parent, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...byId.keys()].sort()) visit(id, []);
  return diagnostics;
}

function supportFor(definition: ConstraintDefinition, targetIds: string[], input: ConstraintCompilationInput, conditionUnknown = false): EnforcementCoverage {
  const configured = input.supportRegistry[definition.kind];
  const fallback = DEFAULT_SUPPORT[definition.kind] ?? {
    consumerId: "unassigned-consumer",
    checkerVersion: "unavailable",
    support: "unsupported" as const,
    requiredInputs: [],
  };
  const selected = configured ?? fallback;
  const support = conditionUnknown ? "unknown" : selected.support;
  return {
    constraintId: definition.id,
    targetIds: [...targetIds].sort(),
    consumerId: selected.consumerId,
    checkerVersion: selected.checkerVersion,
    support,
    requiredInputs: [...selected.requiredInputs].sort(),
    readinessImpact: definition.strength === "hard"
      ? support === "enforced" ? "blocking_failure" : support === "not_applicable" ? "none" : "verification_incomplete"
      : definition.strength === "advisory" ? "advisory" : "none",
    ...(selected.laterStage ? { laterStage: selected.laterStage } : {}),
  };
}

function scalarStrings(requirement: EffectiveConstraintRule["requirement"]): string[] | undefined {
  if (requirement.form !== "allowed_set" && requirement.form !== "forbidden_set" && requirement.form !== "required_set") return undefined;
  return requirement.values.filter((item): item is string => typeof item === "string").sort();
}

function numericRequirement(rule: EffectiveConstraintRule): number | undefined {
  const requirement = rule.requirement;
  if (requirement.form === "minimum") return quantityToInteger(requirement.value, requirement.value.dimension);
  if (requirement.form === "maximum") return quantityToInteger(requirement.value, requirement.value.dimension);
  if (requirement.form === "range") return quantityToInteger(requirement.min, requirement.min.dimension);
  if (requirement.form === "equals" && typeof requirement.value === "object" && "kind" in requirement.value) return Number(requirement.value.value);
  return undefined;
}

function lower(input: {
  rules: EffectiveConstraintRule[];
  relationships: ConstraintCompilationInput["documents"][number]["relationships"];
  programHash: string;
}): ConstraintLowerings {
  const physicalByTarget: Record<string, LoweredPhysicalRule> = {};
  for (const rule of input.rules.filter((item) => item.strength === "hard")) {
    const field = PHYSICAL_KIND_FIELD[rule.kind];
    if (!field) continue;
    const target = physicalByTarget[rule.targetId] ?? { targetId: rule.targetId, constraintIds: [], programHash: input.programHash };
    const strings = scalarStrings(rule.requirement);
    const numeric = numericRequirement(rule);
    if (strings !== undefined && ["allowedLayerIds", "forbiddenLayerIds", "preferredLayerIds", "allowedViaTypes", "allowedViaSpans"].includes(field)) {
      (target as unknown as Record<string, unknown>)[field] = strings;
    } else if (numeric !== undefined) (target as unknown as Record<string, unknown>)[field] = numeric;
    target.constraintIds = [...new Set([...target.constraintIds, ...rule.contributingConstraintIds])].sort();
    physicalByTarget[rule.targetId] = target;
  }
  const relationshipConstraints = new Map<string, string[]>();
  for (const rule of input.rules) {
    const requirement = rule.requirement;
    if (requirement.form === "must_connect" || requirement.form === "must_not_connect") {
      relationshipConstraints.set(requirement.relationshipId, [...new Set([...(relationshipConstraints.get(requirement.relationshipId) ?? []), ...rule.contributingConstraintIds])].sort());
    }
  }
  const graph = input.relationships.map<LoweredRelationshipRule>((relationship) => ({
    relationshipId: relationship.id,
    kind: relationship.kind,
    memberIds: relationship.members.map((member) => member.targetId),
    constraintIds: relationshipConstraints.get(relationship.id) ?? [],
    support: relationship.kind === "differential_pair" || relationship.kind === "current_loop" || relationship.kind === "placement_group" ? "compiled_for_consumer" : "enforced",
  })).sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
  const schematicKinds = new Set<ConstraintKind>(["terminal_connection", "voltage_operating_range", "voltage_absolute_maximum", "current_budget", "decoupling", "exposed_pad_connection", "dnc_connection", "programming_access"]);
  const componentKinds = new Set<ConstraintKind>(["component_category", "approved_part", "forbidden_part", "package_restriction", "qualification", "source_freshness"]);
  return {
    physicalByTarget: Object.fromEntries(Object.entries(physicalByTarget).sort(([a], [b]) => a.localeCompare(b))),
    schematicRules: input.rules.filter((rule) => schematicKinds.has(rule.kind)).sort((a, b) => a.id.localeCompare(b.id)),
    componentSelectionRules: input.rules.filter((rule) => componentKinds.has(rule.kind)).sort((a, b) => a.id.localeCompare(b.id)),
    routingGraph: graph.filter((item) => ["differential_pair", "bus_membership", "current_loop", "return_reference", "termination"].includes(item.kind)),
    placementGraph: graph.filter((item) => ["decoupling", "current_loop", "placement_group", "aggressor_victim", "connector_edge"].includes(item.kind)),
    readinessConstraintIds: [...new Set(input.rules.filter((rule) => rule.strength === "hard").flatMap((rule) => rule.contributingConstraintIds))].sort(),
    kicadConstraintIds: [...new Set(input.rules.filter((rule) => PHYSICAL_KIND_FIELD[rule.kind] !== undefined).flatMap((rule) => rule.contributingConstraintIds))].sort(),
  };
}

export function compileConstraintProgram(input: ConstraintCompilationInput): ConstraintCompilationResult {
  const parsedDocuments = input.documents.map((document) => parseConstraintDocument(JSON.stringify(document)));
  const schemaDiagnostics = parsedDocuments.flatMap((result) => result.diagnostics);
  if (schemaDiagnostics.length > 0) {
    return {
      ok: false,
      candidateHash: constraintSemanticHash({ rejectedDocuments: input.documents }),
      diagnostics: schemaDiagnostics.sort((a, b) => a.id.localeCompare(b.id)),
      conflicts: [],
      targetSnapshots: [],
    };
  }
  const documents = parsedDocuments.map((result) => {
    if (!result.ok) throw new Error("Validated constraint document unexpectedly became unavailable.");
    return canonicalConstraintDocument(result.document);
  }).sort((a, b) => a.id.localeCompare(b.id) || a.revision - b.revision);
  const candidateHash = constraintSemanticHash({ ...input, documents, supportRegistry: input.supportRegistry });
  const diagnostics = inheritanceDiagnostics(documents);
  const allRelationships = documents.flatMap((document) => document.relationships).sort((a, b) => a.id.localeCompare(b.id));
  diagnostics.push(...validateRelationships(allRelationships, input.targets));
  const relationshipTargets = allRelationships.map((relationship) => ({
    id: relationship.id,
    type: relationship.kind === "differential_pair" ? "differential_pair" as const
      : relationship.kind === "bus_membership" ? "bus" as const
        : relationship.kind === "rail_membership" ? "rail" as const
          : "interface" as const,
    revision: constraintSemanticHash(relationship),
    name: relationship.id,
    parentIds: [],
    tags: [relationship.kind],
    attributes: {},
  }));
  const selectorTargetsById = new Map(input.targets.map((target) => [target.id, target]));
  for (const relationshipTarget of relationshipTargets) {
    const existing = selectorTargetsById.get(relationshipTarget.id);
    if (existing && existing.type !== relationshipTarget.type) {
      diagnostics.push(diagnostic(
        "RELATIONSHIP_TARGET_TYPE_CONFLICT",
        `Relationship ${relationshipTarget.id} resolves as ${relationshipTarget.type} but an authoritative target with type ${existing.type} already uses that stable ID.`,
        [],
        [relationshipTarget.id],
      ));
      continue;
    }
    if (!existing) selectorTargetsById.set(relationshipTarget.id, relationshipTarget);
  }
  const selectorTargets = [...selectorTargetsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const definitions = documents.flatMap((document) => document.constraints).filter((definition) => definition.lifecycle.state === "active").sort((a, b) => a.id.localeCompare(b.id));
  const duplicateDefinitionIds = definitions.filter((item, index) => definitions.findIndex((candidate) => candidate.id === item.id) !== index).map((item) => item.id);
  for (const id of [...new Set(duplicateDefinitionIds)].sort()) diagnostics.push(diagnostic("DUPLICATE_ACTIVE_CONSTRAINT_ID", `Active constraint ID ${id} appears in multiple source sets.`, [id]));
  const snapshots = [] as ConstraintProgram["targetSnapshots"];
  const coverage = [] as EnforcementCoverage[];
  const candidates: MergeCandidate[] = [];
  const activeConstraintIds: string[] = [];
  for (const definition of definitions) {
    const resolved = resolveSelector({ constraintId: definition.id, selector: definition.selector, targets: selectorTargets, relationships: allRelationships, designRevision: input.designRevision });
    snapshots.push(resolved.snapshot);
    diagnostics.push(...resolved.diagnostics);
    const unapprovedInference = definition.origin.kind === "deterministic_inference" && definition.origin.reviewState !== "approved";
    if (unapprovedInference) {
      diagnostics.push(diagnostic("INFERENCE_REQUIRES_REVIEW", `Inference ${definition.id} is inspectable but not active engineering truth.`, [definition.id], resolved.snapshot.targetIds, "warning"));
      coverage.push({ ...supportFor(definition, resolved.snapshot.targetIds, input), support: "not_applicable", readinessImpact: definition.strength === "advisory" ? "advisory" : "none" });
      continue;
    }
    const conditionState = evaluateCondition(definition.condition, input.facts);
    if (conditionState === "false") {
      coverage.push({ ...supportFor(definition, resolved.snapshot.targetIds, input), support: "not_applicable", readinessImpact: "none" });
      continue;
    }
    if (conditionState === "unknown") {
      diagnostics.push(diagnostic("CONSTRAINT_CONDITION_UNKNOWN", `Condition for ${definition.id} is unknown; the hard requirement was not silently deactivated.`, [definition.id], resolved.snapshot.targetIds, "warning"));
      coverage.push(supportFor(definition, resolved.snapshot.targetIds, input, true));
      activeConstraintIds.push(definition.id);
      continue;
    }
    activeConstraintIds.push(definition.id);
    coverage.push(supportFor(definition, resolved.snapshot.targetIds, input));
    for (const targetId of resolved.snapshot.targetIds) candidates.push({ definition, targetId, conditionState });
  }
  const merged = mergeConstraintCandidates(candidates);
  const conflictDiagnostics = merged.conflicts.map((item) => diagnostic(item.code, item.explanation, item.constraintIds, [item.targetId]));
  diagnostics.push(...conflictDiagnostics);
  const blocking = diagnostics.some((item) => item.severity === "error");
  const orderedDiagnostics = [...new Map(diagnostics.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
  if (blocking) return { ok: false, candidateHash, diagnostics: orderedDiagnostics, conflicts: merged.conflicts, targetSnapshots: snapshots.sort((a, b) => a.constraintId.localeCompare(b.constraintId)) };
  const semanticBase = {
    schemaVersion: 1 as const,
    compilerVersion: CONSTRAINT_COMPILER_VERSION,
    mergePolicyVersion: CONSTRAINT_MERGE_POLICY_VERSION,
    sourceSetRevisions: documents.map((document) => ({ id: document.id, revision: document.revision })),
    designRevision: input.designRevision,
    catalogRevision: input.catalogRevision,
    variantRevision: input.variantRevision,
    manufacturingProfileRevision: input.manufacturingProfileRevision,
    targetSnapshots: snapshots.sort((a, b) => a.constraintId.localeCompare(b.constraintId)),
    relationshipIds: allRelationships.map((relationship) => relationship.id),
    activeConstraintIds: [...new Set(activeConstraintIds)].sort(),
    effectiveRules: merged.rules,
    conflicts: merged.conflicts,
    diagnostics: orderedDiagnostics,
    coverage: coverage.sort((a, b) => a.constraintId.localeCompare(b.constraintId) || a.consumerId.localeCompare(b.consumerId)),
  };
  const loweringsWithoutHash = lower({ rules: merged.rules, relationships: allRelationships, programHash: "pending" });
  const programHash = constraintSemanticHash({ ...semanticBase, lowerings: loweringsWithoutHash });
  const program: ConstraintProgram = {
    ...semanticBase,
    programHash,
    lowerings: lower({ rules: merged.rules, relationships: allRelationships, programHash }),
  };
  return { ok: true, program: deepFreezeConstraint(program) as ConstraintProgram, diagnostics: orderedDiagnostics };
}

export function recomputeConstraintProgramHash(program: ConstraintProgram): string {
  const { lowerings } = program;
  const semantic = { ...program, programHash: undefined };
  return constraintSemanticHash({
    ...semantic,
    lowerings: {
      ...lowerings,
      physicalByTarget: Object.fromEntries(Object.entries(lowerings.physicalByTarget).map(([id, rule]) => [id, { ...rule, programHash: "pending" }])),
    },
  });
}

export function constraintProgramIntegrityErrors(program: ConstraintProgram): string[] {
  const errors: string[] = [];
  if (program.compilerVersion !== CONSTRAINT_COMPILER_VERSION) errors.push("compiler version mismatch");
  if (program.mergePolicyVersion !== CONSTRAINT_MERGE_POLICY_VERSION) errors.push("merge policy version mismatch");
  if (recomputeConstraintProgramHash(program) !== program.programHash) errors.push("program semantic hash mismatch");
  for (const rule of Object.values(program.lowerings.physicalByTarget)) if (rule.programHash !== program.programHash) errors.push(`lowered physical rule ${rule.targetId} has a mismatched program hash`);
  return [...new Set(errors)].sort();
}
