import type { PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import type { DrcPreset, DrcResult } from "../drc/types";
import type { FabPreset } from "../fab/types";
import { runDrc } from "../drc/run-drc";
import { computeElectricalTruth, type ElectricalTruthReport } from "../electrical-truth";
import {
  compareDiagnostics,
  engineeringDiagnostic,
  validateReferenceDesignators,
  type EngineeringDiagnostic,
} from "../integrity";
import { canonicalJson, pcbRevisionId } from "../revision";
import { stableHash } from "../smart-routing/hash";
import { netlistFromBoard } from "../kicad/write-pcb";
import { buildSchematicParityCertificate } from "./parity";
import { runExportPreflight } from "./preflight";
import type { ConstraintEvaluationReport, ConstraintKind, ConstraintProgram } from "@/app/lib/constraints/types";
import { constraintResultsFromDrc } from "@/app/lib/constraints/drc-adapter";
import { runPhysicalConstraintChecks } from "@/app/lib/constraints/physical-checker";
import { evaluateConstraintProgram } from "@/app/lib/constraints/evaluation";
import { compileManufacturingConstraintProgram } from "@/app/lib/constraints/manufacturing";
import {
  PCB_FABRICATION_CLAIM,
  READINESS_POLICY_VERSION,
  READINESS_REPORT_SCHEMA,
  type ExportPreflightResult,
  type ReadinessCheckCode,
  type ReadinessCheckResult,
  type ReadinessEvidenceState,
  type ReadinessReport,
  type ReadinessState,
  type ReadinessViewModel,
  type ReleaseWaiver,
  type SchematicParityCertificate,
} from "./types";
import { compareCodePoints } from "@/app/lib/stable-compare";

const CHECK_ORDER: ReadinessCheckCode[] = [
  "IDENTITY_INTEGRITY",
  "SCHEMATIC_PARITY",
  "PHYSICAL_ASSIGNMENT",
  "ELECTRICAL_REALIZATION",
  "ENGINEERING_CONSTRAINTS",
  "PCB_DRC",
  "MANUFACTURING_REPRESENTATION",
  "EXPORT_PREFLIGHT",
];

const CHECK_VERSION: Record<ReadinessCheckCode, string> = {
  IDENTITY_INTEGRITY: "identity/1",
  SCHEMATIC_PARITY: "parity/1",
  PHYSICAL_ASSIGNMENT: "assignment/1",
  ELECTRICAL_REALIZATION: "realization/1",
  ENGINEERING_CONSTRAINTS: "constraint-evaluation/1",
  PCB_DRC: "pcb-drc/2",
  MANUFACTURING_REPRESENTATION: "manufacturing-representation/1",
  EXPORT_PREFLIGHT: "export-preflight/1",
};

const NON_WAIVABLE = new Set<ReadinessCheckCode>(["IDENTITY_INTEGRITY", "PHYSICAL_ASSIGNMENT", "EXPORT_PREFLIGHT"]);
const INCOMPLETE_STATES = new Set<ReadinessEvidenceState>(["unknown", "not_run", "unsupported"]);
const ENGINEERING_WAIVABLE_DRC_CODES = new Set([
  "DRC_INCOMPLETENET",
  "DRC_UNCONNECTED",
  "DRC_SILKOVERPAD",
  "DRC_COURTYARDOVERLAP",
]);

function stableDiagnostic(diagnostic: EngineeringDiagnostic): EngineeringDiagnostic {
  return {
    ...diagnostic,
    ...(diagnostic.objectIds ? { objectIds: [...new Set(diagnostic.objectIds)].sort() } : {}),
    ...(diagnostic.componentIds ? { componentIds: [...new Set(diagnostic.componentIds)].sort() } : {}),
    ...(diagnostic.netStableIds ? { netStableIds: [...new Set(diagnostic.netStableIds)].sort() } : {}),
    ...(diagnostic.suggestedActions ? { suggestedActions: [...new Set(diagnostic.suggestedActions)] } : {}),
  };
}

function auditIdentity(board: PcbBoard): EngineeringDiagnostic[] {
  const diagnostics = [...validateReferenceDesignators(board.footprints)];
  const numeric = new Map<number, number>();
  const stable = new Map<string, number>();
  for (const net of board.nets) {
    numeric.set(net.id, (numeric.get(net.id) ?? 0) + 1);
    if (!net.stableId) diagnostics.push(engineeringDiagnostic(
      "MISSING_STABLE_NET_IDENTITY",
      `Net ${net.name || net.id} has no persistent stable identity.`,
      { context: { numericNetId: net.id } },
    ));
    else stable.set(net.stableId, (stable.get(net.stableId) ?? 0) + 1);
  }
  for (const [netId, count] of numeric) if (count > 1) diagnostics.push(engineeringDiagnostic(
    "DUPLICATE_NUMERIC_NET_ID",
    `Numeric net ID ${netId} occurs ${count} times.`,
    { context: { netId, count } },
  ));
  for (const [stableNetId, count] of stable) if (count > 1) diagnostics.push(engineeringDiagnostic(
    "DUPLICATE_STABLE_NET_ID",
    `Stable net identity ${stableNetId} occurs ${count} times.`,
    { netStableIds: [stableNetId], context: { count } },
  ));
  if (!numeric.has(0)) diagnostics.push(engineeringDiagnostic("MISSING_UNCONNECTED_NET", "Reserved unconnected net 0 is absent."));
  if (board.identityVersion !== 1) diagnostics.push(engineeringDiagnostic(
    "ELECTRICAL_IDENTITY_MIGRATION_REQUIRED",
    "The board has no current persistent electrical-identity schema marker.",
  ));
  const validNetIds = new Set(board.nets.map((net) => net.id));
  const check = (netId: number, objectId: string): void => {
    if (netId !== 0 && !validNetIds.has(netId)) diagnostics.push(engineeringDiagnostic(
      "UNKNOWN_NUMERIC_NET_REFERENCE",
      `${objectId} references missing numeric net ${netId}.`,
      { objectIds: [objectId], context: { netId } },
    ));
  };
  board.tracks.forEach((item) => check(item.netId, `track:${item.id}`));
  board.vias.forEach((item) => check(item.netId, `via:${item.id}`));
  board.zones.forEach((item) => check(item.netId, `zone:${item.id}`));
  board.footprints.forEach((footprint) => Object.entries(footprint.padNets)
    .forEach(([pad, netId]) => check(netId, `pad:${footprint.id}:${pad}`)));
  return diagnostics.map(stableDiagnostic).sort(compareDiagnostics);
}

function checkResult(input: {
  code: ReadinessCheckCode;
  state: ReadinessEvidenceState;
  summary: string;
  revision: string;
  diagnostics?: EngineeringDiagnostic[];
  sourceIds?: string[];
  suggestedActions?: string[];
  waivable?: boolean;
}): ReadinessCheckResult {
  const diagnostics = (input.diagnostics ?? []).map(stableDiagnostic).sort(compareDiagnostics);
  return {
    code: input.code,
    version: CHECK_VERSION[input.code],
    required: true,
    state: input.state,
    summary: input.summary,
    designRevision: input.revision,
    sourceIds: [...new Set(input.sourceIds ?? [])].sort(),
    componentIds: [...new Set(diagnostics.flatMap((item) => item.componentIds ?? []))].sort(),
    netStableIds: [...new Set(diagnostics.flatMap((item) => item.netStableIds ?? []))].sort(),
    objectIds: [...new Set(diagnostics.flatMap((item) => item.objectIds ?? []))].sort(),
    diagnostics,
    suggestedActions: [...new Set(input.suggestedActions ?? diagnostics.flatMap((item) => item.suggestedActions ?? []))],
    waivableForEngineeringExport: input.waivable ?? !NON_WAIVABLE.has(input.code),
  };
}

function validWaiver(waiver: ReleaseWaiver, revision: string, fabPreset: FabPreset): boolean {
  return waiver.claim === PCB_FABRICATION_CLAIM && waiver.designRevision === revision &&
    waiver.policyVersion === READINESS_POLICY_VERSION && waiver.manufacturingProfileId === fabPreset.id &&
    waiver.manufacturingProfileVersion === fabPreset.version && waiver.reason.trim().length >= 8;
}

function waiverCoversCheck(waiver: ReleaseWaiver, check: ReadinessCheckResult): boolean {
  return waiver.checkCodes.includes(check.code) &&
    check.diagnostics.every((diagnostic) => waiver.diagnosticCodes.includes(diagnostic.code)) &&
    check.componentIds.every((id) => waiver.componentIds.includes(id)) &&
    check.netStableIds.every((id) => waiver.netStableIds.includes(id)) &&
    check.objectIds.every((id) => waiver.objectIds.includes(id));
}

export interface AggregateReadinessInput {
  designRevision: string;
  currentDesignRevision?: string;
  fabPreset: FabPreset;
  checks: ReadinessCheckResult[];
  parity: SchematicParityCertificate;
  electricalTruth: ElectricalTruthReport;
  drcResult?: DrcResult;
  preflight: ExportPreflightResult;
  waivers?: ReleaseWaiver[];
  constraintEvaluation?: ConstraintEvaluationReport;
}

/** Pure deterministic aggregation. It never computes evidence or consults UI/LLM/global state. */
export function aggregateReadiness(input: AggregateReadinessInput): ReadinessReport {
  const currentRevision = input.currentDesignRevision ?? input.designRevision;
  const checks = [...input.checks].sort((a, b) => CHECK_ORDER.indexOf(a.code) - CHECK_ORDER.indexOf(b.code));
  const profileMismatch = input.preflight.manufacturingProfileId !== input.fabPreset.id ||
    input.preflight.manufacturingProfileVersion !== input.fabPreset.version;
  const stale = currentRevision !== input.designRevision || profileMismatch || checks.some((check) =>
    check.state === "stale" || check.designRevision !== input.designRevision,
  );
  const overallState: ReadinessState = stale
    ? "stale"
    : checks.some((check) => check.state === "fail")
      ? "blocked"
      : checks.some((check) => INCOMPLETE_STATES.has(check.state))
        ? "verification_incomplete"
        : checks.every((check) => check.state === "pass")
          ? "ready"
          : "verification_incomplete";

  const blockers = checks.filter((check) => check.state === "fail").flatMap((check) => check.diagnostics);
  const unknowns = checks.filter((check) => INCOMPLETE_STATES.has(check.state)).flatMap((check) =>
    check.diagnostics.length > 0 ? check.diagnostics : [engineeringDiagnostic(
      `${check.code}_${check.state.toUpperCase()}`,
      check.summary,
      { severity: "warning", suggestedActions: check.suggestedActions },
    )],
  );
  if (stale) unknowns.push(engineeringDiagnostic(
    "READINESS_REPORT_STALE",
    "Readiness evidence does not describe the requested design revision, policy, or manufacturing profile.",
    { severity: "warning", context: { reportRevision: input.designRevision, currentRevision } },
  ));
  const warnings = [
    ...(input.drcResult?.violations.filter((item) => item.severity !== "error").map((item) => engineeringDiagnostic(
      `DRC_${item.kind.toUpperCase()}`,
      item.summary,
      { severity: item.severity, objectIds: item.objectIds ?? [], context: { violationId: item.id } },
    )) ?? []),
    ...input.electricalTruth.orphanCopper.map((orphan) => engineeringDiagnostic(
      "ORPHAN_COPPER",
      `${orphan.objectId} is not part of a proven terminal-to-terminal path.`,
      { severity: "warning", objectIds: [orphan.objectId], netStableIds: orphan.stableNetId ? [orphan.stableNetId] : [] },
    )),
  ].map(stableDiagnostic).sort(compareDiagnostics);

  const suppliedWaivers = [...(input.waivers ?? [])].sort((a, b) => compareCodePoints(a.id, b.id));
  const waivers = suppliedWaivers.filter((waiver) => validWaiver(waiver, input.designRevision, input.fabPreset));
  const unresolvedChecks = checks.filter((check) => check.state !== "pass");
  const nonWaivable = stale || unresolvedChecks.some((check) => !check.waivableForEngineeringExport);
  const covered = unresolvedChecks.every((check) => waivers.some((waiver) => waiverCoversCheck(waiver, check)));
  const overrideDisposition: ReadinessReport["overrideDisposition"] = overallState === "ready"
    ? "none"
    : nonWaivable
      ? "denied"
      : waivers.length > 0 && covered
        ? "authorized"
        : "available";
  const permittedActions: ReadinessReport["permittedActions"] = ["interchange_export"];
  if (overallState === "ready") permittedActions.push("verified_manufacturing_release", "engineering_prototype_export");
  else if (overrideDisposition === "authorized") permittedActions.push("engineering_prototype_export");
  else if (overrideDisposition === "available") permittedActions.push("create_engineering_override");

  const semantic = {
    schemaVersion: READINESS_REPORT_SCHEMA,
    claim: PCB_FABRICATION_CLAIM,
    claimVersion: "1" as const,
    designRevision: input.designRevision,
    policyVersion: READINESS_POLICY_VERSION,
    manufacturingProfileId: input.fabPreset.id,
    manufacturingProfileVersion: input.fabPreset.version,
    overallState,
    checks,
    parity: input.parity,
    blockers: blockers.map(stableDiagnostic).sort(compareDiagnostics),
    unknowns: unknowns.map(stableDiagnostic).sort(compareDiagnostics),
    warnings,
    waivers,
    overrideDisposition,
    permittedActions,
  };
  const text = canonicalJson(semantic);
  return {
    ...semantic,
    reportId: `ready1-${stableHash(`a\0${text}`)}${stableHash(`b\0${text}`)}`,
    claimStatement: "Evaluates PCB fabrication checks for this exact design revision under the implemented checks and selected manufacturing profile; only an overallState of ready asserts that they passed.",
    limitations: [
      "This does not prove circuit function or product requirements.",
      "Datasheet application rules, signal integrity, power integrity, thermal, EMC, reliability, sourcing, regulatory, and production qualification are not verified.",
    ],
    freshness: stale ? "stale" : "current",
    evidence: {
      electricalSchema: input.electricalTruth.schemaVersion,
      drcSchema: input.drcResult?.schemaVersion ?? "not-run",
      drcCheckVersion: input.drcResult?.checkVersion ?? "not-run",
      paritySchema: input.parity.schemaVersion,
      exportPreflightSchema: input.preflight.schemaVersion,
      exporterVersion: input.preflight.exporterVersion,
      ...(input.constraintEvaluation ? {
        constraintProgramHash: input.constraintEvaluation.programHash,
        constraintEvaluationHash: input.constraintEvaluation.evaluationHash,
      } : {}),
    },
    ...(input.constraintEvaluation ? {
      constraints: {
        programHash: input.constraintEvaluation.programHash,
        evaluationHash: input.constraintEvaluation.evaluationHash,
        state: input.constraintEvaluation.readinessState,
      },
    } : {}),
    metrics: {
      requiredConnections: input.electricalTruth.realized.requiredConnections,
      completedConnections: input.electricalTruth.realized.completedConnections,
      remainingConnections: input.electricalTruth.realized.remainingConnections,
      drcErrors: input.drcResult?.violations.filter((item) => item.severity === "error").length ?? 0,
      drcWarnings: input.drcResult?.violations.filter((item) => item.severity === "warning").length ?? 0,
    },
  };
}

export interface EvaluatePcbReadinessInput {
  board: PcbBoard;
  netlist?: PcbNetlist;
  fabPreset: FabPreset;
  drcPreset: DrcPreset;
  exporter?: ExportPreflightResult["exporter"];
  electricalTruth?: ElectricalTruthReport;
  drcResult?: DrcResult;
  preflight?: ExportPreflightResult;
  waivers?: ReleaseWaiver[];
  currentDesignRevision?: string;
  constraintEvaluation?: ConstraintEvaluationReport;
  constraintProjectId?: string;
}

const FABRICATION_CONSTRAINT_KINDS = new Set<ConstraintKind>([
  "trace_width", "clearance", "same_net_feature", "via_diameter", "via_drill", "annular_ring",
  "pth_annular_ring", "hole_clearance", "edge_clearance", "mask_clearance", "paste_rule", "silk_clearance",
  "courtyard_clearance", "allowed_layers", "forbidden_layers", "via_type", "via_span", "via_count",
  "zone_connection", "zone_thermal_gap", "zone_thermal_spokes", "zone_island_area", "keepout",
]);

export function constraintReadinessCheck(input: {
  evaluation: ConstraintEvaluationReport;
  revision: string;
  program: ConstraintProgram;
}): ReadinessCheckResult {
  const requiredIds = new Set(input.program.effectiveRules
    .filter((rule) => rule.strength === "hard" && FABRICATION_CONSTRAINT_KINDS.has(rule.kind))
    .flatMap((rule) => rule.contributingConstraintIds));
  const states = input.evaluation.states.filter((state) => requiredIds.has(state.constraintId));
  const stale = input.evaluation.programHash !== input.program.programHash || input.evaluation.designRevision !== input.program.designRevision;
  const state: ReadinessEvidenceState = stale || states.some((item) => item.state === "stale")
    ? "stale"
    : states.some((item) => item.state === "fail")
      ? "fail"
      : states.some((item) => item.state === "unsupported")
        ? "unsupported"
        : states.some((item) => item.state === "unknown")
          ? "unknown"
          : states.some((item) => item.state === "not_run")
            ? "not_run"
            : "pass";
  const relevantViolations = input.evaluation.violations.filter((item) => requiredIds.has(item.constraintId) && item.state !== "pass" && item.state !== "not_applicable");
  const diagnostics = relevantViolations.map((item) => engineeringDiagnostic(
    `CONSTRAINT_${item.state.toUpperCase()}`,
    item.message,
    { severity: item.state === "fail" ? "error" : "warning", objectIds: item.targetIds, context: { constraintId: item.constraintId, violationId: item.id, programHash: input.program.programHash } },
  ));
  if (diagnostics.length === 0 && state !== "pass") diagnostics.push(engineeringDiagnostic(
    `CONSTRAINT_${state.toUpperCase()}`,
    `Required fabrication constraints are ${state.replace("_", " ")}.`,
    { severity: state === "fail" ? "error" : "warning", context: { programHash: input.program.programHash } },
  ));
  return checkResult({
    code: "ENGINEERING_CONSTRAINTS",
    state,
    summary: state === "pass" ? "All fabrication-scoped typed constraints have current passing evidence." : `Fabrication constraint evaluation is ${state.replace("_", " ")}.`,
    revision: input.revision,
    diagnostics,
    sourceIds: [input.program.programHash, input.evaluation.evaluationHash],
    suggestedActions: ["Open the effective-rule inspector, resolve failures or unknown coverage, and rerun the named deterministic checker."],
    waivable: false,
  });
}

export function evaluatePcbFabricationReadiness(input: EvaluatePcbReadinessInput): ReadinessReport {
  const revision = pcbRevisionId(input.board);
  const electricalTruth = input.electricalTruth?.designRevision === revision
    ? input.electricalTruth
    : computeElectricalTruth(input.board);
  const parity = buildSchematicParityCertificate(input.board, revision, input.netlist, revision);
  const identityDiagnostics = auditIdentity(input.board);
  const baseConstraintProgram = input.board.constraintState?.activeProgram;
  const manufacturingCompilation = baseConstraintProgram
    ? compileManufacturingConstraintProgram({ board: input.board, projectId: input.constraintProjectId ?? "readiness", preset: input.drcPreset })
    : undefined;
  const constraintProgram = manufacturingCompilation?.ok ? manufacturingCompilation.program : baseConstraintProgram;
  const drcResult = input.drcResult ?? runDrc(input.board, input.drcPreset.rules, {
    presetId: input.drcPreset.id,
    electricalReport: electricalTruth,
    ...(manufacturingCompilation?.ok ? { constraintProgram: manufacturingCompilation.program } : {}),
  });
  const constraintEvaluation = input.constraintEvaluation ?? (constraintProgram && manufacturingCompilation?.ok !== false ? evaluateConstraintProgram({
    program: constraintProgram,
    designRevision: constraintProgram.designRevision,
    results: [
      ...constraintResultsFromDrc(constraintProgram, drcResult),
      ...runPhysicalConstraintChecks({ program: constraintProgram, board: input.board, designRevision: constraintProgram.designRevision }),
    ],
    waivers: input.board.constraintState?.waivers,
  }) : undefined);
  const writerNetlist = input.netlist ?? netlistFromBoard(input.board);
  const preflight = input.preflight ?? runExportPreflight({
    board: input.board,
    netlist: writerNetlist,
    fabPreset: input.fabPreset,
    drcRules: input.drcPreset.rules,
    exporter: input.exporter ?? "kicad-assisted",
  });

  const assignmentDiagnostics = electricalTruth.diagnostics.filter((item) =>
    item.code === "ELECTRICAL_ASSIGNMENT_INCOMPLETE" || item.code.includes("MAPPING"),
  );
  const realizationFailures = [
    ...(electricalTruth.realized.remainingConnections > 0 ? [engineeringDiagnostic(
      "ELECTRICAL_CONNECTIONS_OPEN",
      `${electricalTruth.realized.remainingConnections} required electrical connection(s) remain open.`,
      { netStableIds: electricalTruth.nets.filter((net) => net.remainingConnections > 0).map((net) => net.stableNetId) },
    )] : []),
    ...electricalTruth.shorts.map((short) => engineeringDiagnostic(
      "ELECTRICAL_SHORT",
      `Different stable nets touch at ${short.objectIds.join(" and ")}.`,
      { objectIds: short.objectIds, netStableIds: short.stableNetIds },
    )),
  ];
  const unresolvedDiagnostics = electricalTruth.unresolved.map((unknown) => engineeringDiagnostic(
    unknown.code,
    unknown.summary,
    { severity: "warning", objectIds: unknown.objectIds, netStableIds: unknown.stableNetId ? [unknown.stableNetId] : [] },
  ));
  const drcStale = drcResult.designRevision !== revision || drcResult.presetId !== input.drcPreset.id;
  const drcAborted = drcResult.execution !== "completed";
  const drcErrors = drcResult.violations.filter((item) => item.severity === "error");
  const drcDiagnostics = drcErrors.map((item) => engineeringDiagnostic(
    `DRC_${item.kind.toUpperCase()}`,
    item.summary,
    { objectIds: item.objectIds ?? [], context: { violationId: item.id } },
  ));
  const representationUnknown = unresolvedDiagnostics.filter((item) =>
    item.code === "NATIVE_PLANE_UNRESOLVED" || item.code === "ZONE_FILL_UNRESOLVED",
  );

  const checks: ReadinessCheckResult[] = [
    checkResult({
      code: "IDENTITY_INTEGRITY",
      state: identityDiagnostics.length > 0 ? "fail" : "pass",
      summary: identityDiagnostics.length > 0 ? "Persistent PCB identity invariants failed." : "Persistent component, net, reference, and ownership identities are valid.",
      revision,
      diagnostics: identityDiagnostics,
      sourceIds: [revision, "identity-audit/1"],
      waivable: false,
    }),
    checkResult({
      code: "SCHEMATIC_PARITY",
      state: parity.state === "pass" ? "pass" : parity.state === "fail" ? "fail" : parity.state,
      summary: parity.state === "pass" ? "Authoritative schematic and PCB stable identity sets are conserved." :
        parity.state === "fail" ? "Schematic-to-PCB identity-set parity failed." : "Schematic-to-PCB parity is not proven.",
      revision,
      diagnostics: parity.diagnostics,
      sourceIds: [parity.schematicRevision ?? "schematic-unavailable", parity.schemaVersion],
      suggestedActions: ["Synchronize the authoritative schematic and resolve every reported identity difference."],
      waivable: parity.state === "unknown",
    }),
    checkResult({
      code: "PHYSICAL_ASSIGNMENT",
      state: electricalTruth.assigned.state === "proven" ? "pass" : electricalTruth.assigned.state === "failed" ? "fail" : "unknown",
      summary: electricalTruth.assigned.state === "proven" ? "Every required logical terminal has an unambiguous physical assignment." : "Physical pin-to-pad assignment is incomplete or ambiguous.",
      revision,
      diagnostics: assignmentDiagnostics,
      sourceIds: [electricalTruth.designRevision, electricalTruth.schemaVersion],
      waivable: false,
    }),
    checkResult({
      code: "ELECTRICAL_REALIZATION",
      state: realizationFailures.length > 0 ? "fail" : unresolvedDiagnostics.length > 0 ? "unknown" : electricalTruth.realized.state === "proven" ? "pass" : "fail",
      summary: realizationFailures.length > 0 ? "Required native electrical connectivity is incomplete or shorted." :
        unresolvedDiagnostics.length > 0 ? "Native electrical realization contains unresolved facts." : "Required terminal groups are completely realized with no shorts.",
      revision,
      diagnostics: realizationFailures.length > 0 ? realizationFailures : unresolvedDiagnostics,
      sourceIds: [electricalTruth.designRevision, electricalTruth.schemaVersion],
      waivable: realizationFailures.length > 0 &&
        realizationFailures.every((item) => item.code === "ELECTRICAL_CONNECTIONS_OPEN"),
    }),
    ...(manufacturingCompilation && !manufacturingCompilation.ok
      ? [checkResult({
          code: "ENGINEERING_CONSTRAINTS",
          state: "fail",
          summary: "The selected manufacturing profile conflicts with active typed constraints.",
          revision,
          diagnostics: manufacturingCompilation.diagnostics.map((item) => engineeringDiagnostic(item.code, item.message, { objectIds: item.targetIds, context: { constraintIds: item.constraintIds, candidateHash: manufacturingCompilation.candidateHash } })),
          sourceIds: [manufacturingCompilation.candidateHash, input.drcPreset.id],
          waivable: false,
        })]
      : constraintEvaluation && constraintProgram
        ? [constraintReadinessCheck({ evaluation: constraintEvaluation, revision, program: constraintProgram })]
        : []),
    checkResult({
      code: "PCB_DRC",
      state: drcStale ? "stale" : drcAborted ? "not_run" : drcErrors.length > 0 ? "fail" : "pass",
      summary: drcStale ? "DRC evidence is stale or belongs to another manufacturing profile." :
        drcAborted ? "The complete PCB DRC suite did not finish." : drcErrors.length > 0 ? `${drcErrors.length} blocking PCB DRC violation(s) remain.` : "All implemented blocking PCB DRC checks completed and passed.",
      revision: drcResult.designRevision,
      diagnostics: drcStale ? [engineeringDiagnostic("DRC_RESULT_STALE", "DRC result revision/profile does not match this readiness request.")] :
        drcAborted ? [engineeringDiagnostic("DRC_NOT_COMPLETED", "DRC was canceled or aborted before all checks ran.", { severity: "warning" })] : drcDiagnostics,
      sourceIds: [drcResult.designRevision, drcResult.schemaVersion, drcResult.checkVersion, drcResult.presetId ?? "preset-unbound"],
      waivable: !drcStale && !drcAborted && drcDiagnostics.length > 0 &&
        drcDiagnostics.every((item) => ENGINEERING_WAIVABLE_DRC_CODES.has(item.code)),
    }),
    checkResult({
      code: "MANUFACTURING_REPRESENTATION",
      state: representationUnknown.length > 0 ? "unknown" : "pass",
      summary: representationUnknown.length > 0 ? "Manufacturing conductivity representation contains unresolved native planes or fills." : "Stackup, native fills, outline, and supported manufacturing constructs are represented.",
      revision,
      diagnostics: representationUnknown,
      sourceIds: [electricalTruth.designRevision, electricalTruth.schemaVersion],
      waivable: false,
    }),
    checkResult({
      code: "EXPORT_PREFLIGHT",
      state: preflight.designRevision !== revision || preflight.manufacturingProfileId !== input.fabPreset.id ? "stale" : preflight.state,
      summary: preflight.state === "pass" ? "Exporter structural and conservation preflight passed for this snapshot." : "Exporter structural or conservation preflight did not pass.",
      revision: preflight.designRevision,
      diagnostics: preflight.diagnostics,
      sourceIds: [preflight.designRevision, preflight.schemaVersion, preflight.exporterVersion],
      waivable: false,
    }),
  ];
  return aggregateReadiness({
    designRevision: revision,
    currentDesignRevision: input.currentDesignRevision,
    fabPreset: input.fabPreset,
    checks,
    parity,
    electricalTruth,
    drcResult,
    preflight,
    waivers: input.waivers,
    constraintEvaluation,
  });
}

export function readinessViewModel(report: ReadinessReport): ReadinessViewModel {
  const label = report.overallState === "ready" ? "PCB fabrication checks passed" :
    report.overallState === "blocked" ? `Blocked: ${report.blockers.length} proven failure${report.blockers.length === 1 ? "" : "s"}` :
      report.overallState === "stale" ? "Stale: design changed after verification" :
        `Verification incomplete: ${report.unknowns.length} required fact${report.unknowns.length === 1 ? "" : "s"} unproven`;
  const first = report.blockers[0] ?? report.unknowns[0] ?? report.warnings[0];
  return {
    claim: report.claim,
    state: report.overallState,
    label,
    detail: first?.summary ?? report.claimStatement,
    blockerCount: report.blockers.length,
    unknownCount: report.unknowns.length,
    warningCount: report.warnings.length,
    remainingConnections: report.metrics.remainingConnections,
    reportId: report.reportId,
    designRevision: report.designRevision,
  };
}
