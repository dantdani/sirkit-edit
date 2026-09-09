import type { PcbBoard } from "@/app/lib/pcb/types";
import type { DrcPreset, DrcRuleSet } from "@/app/lib/pcb/drc/types";
import type { ConstraintCompilationResult, ConstraintDefinition, ConstraintDocument, ConstraintKind, TypedSelector } from "./types";
import { compileConstraintProgram } from "./compiler";
import { boardConstraintTargetRevision, boardConstraintTargets } from "./board-model";
import { constraintSemanticHash } from "./stable";

const DOCUMENT_PREFIX = "constraint-set:manufacturing:";

const FIELDS: Array<{ field: keyof DrcRuleSet; kind: ConstraintKind }> = [
  { field: "clearanceNm", kind: "clearance" },
  { field: "minTrackWidthNm", kind: "trace_width" },
  { field: "minViaOuterNm", kind: "via_diameter" },
  { field: "minViaDrillNm", kind: "via_drill" },
  { field: "minAnnularRingNm", kind: "annular_ring" },
  { field: "minPthAnnularRingNm", kind: "pth_annular_ring" },
  { field: "minHoleToHoleNm", kind: "hole_clearance" },
  { field: "minEdgeClearanceNm", kind: "edge_clearance" },
  { field: "minSilkPadClearanceNm", kind: "silk_clearance" },
  { field: "minCourtyardClearanceNm", kind: "courtyard_clearance" },
];

// Silk-over-pad is a yield risk, not a hard failure — the DRC engine emits it
// as warning severity by explicit policy (see drc/checks/silk.ts). The compiled
// constraint must declare the SAME policy: advisory, never release-blocking.
// Declaring it "hard" overclaimed enforcement that nothing in the product
// applies, and pinned readiness at "verification incomplete" forever.
const ADVISORY_KINDS = new Set<ConstraintKind>(["silk_clearance"]);

function definition(input: { preset: DrcPreset; selector: TypedSelector; scopeId: string; field: keyof DrcRuleSet; kind: ConstraintKind; value: number }): ConstraintDefinition {
  return {
    id: `manufacturing:${input.preset.id}:v${input.preset.version}:${input.scopeId}:${input.field}`,
    revision: 1,
    name: `${input.preset.name} ${input.field}`,
    domain: "manufacturing",
    kind: input.kind,
    scope: { type: "manufacturing_profile", id: `manufacturing-profile:${input.preset.id}:v${input.preset.version}` },
    selector: input.selector,
    requirement: { form: "minimum", value: { dimension: "length", value: String(input.value), unit: "nm" } },
    strength: ADVISORY_KINDS.has(input.kind) ? "advisory" : "hard",
    severityPolicyId: ADVISORY_KINDS.has(input.kind) ? "severity:manufacturing-advisory" : "severity:manufacturing-blocking",
    origin: { kind: "manufacturing_profile", sourceId: input.preset.specUrl, sourceRevision: `${input.preset.id}:v${input.preset.version}:${input.preset.verifiedAt}` },
    evidenceIds: [input.preset.specUrl],
    lifecycle: { state: "active" },
    waiverPolicy: { eligible: false, reason: "Change the selected manufacturing profile; a waiver does not weaken its effective minimum." },
  };
}

export function manufacturingConstraintDocument(board: PcbBoard, preset: DrcPreset): ConstraintDocument {
  const netIds = board.nets.filter((net) => net.id !== 0 && net.stableId).map((net) => net.stableId!).sort();
  const constraints: ConstraintDefinition[] = [];
  const allNets: TypedSelector = { objectType: "net", predicate: netIds.length > 0 ? { kind: "ids", ids: netIds } : { kind: "all" }, cardinality: netIds.length > 0 ? { kind: "exactly", count: netIds.length } : { kind: "zero_or_more" } };
  for (const mapping of FIELDS) constraints.push(definition({ preset, selector: allNets, scopeId: "default", field: mapping.field, kind: mapping.kind, value: preset.rules.default[mapping.field] }));
  for (const [classId, overrides] of Object.entries(preset.rules.perClass).sort(([a], [b]) => a.localeCompare(b))) {
    if (!overrides) continue;
    const selector: TypedSelector = { objectType: "net", predicate: { kind: "attribute", field: "classId", operator: "eq", value: classId }, cardinality: { kind: "zero_or_more" } };
    for (const mapping of FIELDS) {
      const value = overrides[mapping.field];
      if (value !== undefined) constraints.push(definition({ preset, selector, scopeId: `class:${classId}`, field: mapping.field, kind: mapping.kind, value }));
    }
  }
  for (const [numericId, overrides] of Object.entries(preset.rules.perNet ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    const stableId = board.nets.find((net) => net.id === Number(numericId))?.stableId;
    if (!stableId) continue;
    const selector: TypedSelector = { objectType: "net", predicate: { kind: "ids", ids: [stableId] }, cardinality: { kind: "exactly", count: 1 } };
    for (const mapping of FIELDS) {
      const value = overrides[mapping.field];
      if (value !== undefined) constraints.push(definition({ preset, selector, scopeId: `net:${stableId}`, field: mapping.field, kind: mapping.kind, value }));
    }
  }
  return {
    schemaVersion: 1,
    id: `${DOCUMENT_PREFIX}${preset.id}`,
    revision: preset.version,
    name: preset.name,
    description: `Verified ${preset.verifiedAt}; source ${preset.specUrl}. Values compile through restrictive algebra and cannot be weakened by a net/object rule.`,
    extendsSetIds: [],
    constraints: constraints.sort((a, b) => a.id.localeCompare(b.id)),
    relationships: [],
  };
}

export function compileManufacturingConstraintProgram(input: { board: PcbBoard; projectId: string; preset: DrcPreset }): ConstraintCompilationResult {
  const active = input.board.constraintState?.activeProgram;
  const documents = [
    ...(input.board.constraintState?.documents ?? []).filter((document) => !document.id.startsWith(DOCUMENT_PREFIX)),
    manufacturingConstraintDocument(input.board, input.preset),
  ];
  return compileConstraintProgram({
    documents,
    targets: boardConstraintTargets(input.board, input.projectId),
    facts: [],
    designRevision: boardConstraintTargetRevision(input.board, input.projectId),
    catalogRevision: active?.catalogRevision ?? "catalog:unbound",
    variantRevision: active?.variantRevision ?? "variant:default",
    manufacturingProfileRevision: constraintSemanticHash({ id: input.preset.id, version: input.preset.version, verifiedAt: input.preset.verifiedAt, rules: input.preset.rules }),
    supportRegistry: {},
  });
}

