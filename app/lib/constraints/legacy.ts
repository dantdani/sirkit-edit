import type { PcbBoard } from "@/app/lib/pcb/types";
import { DEFAULT_CLASSES, type NetClassId, type RuleDeltaChange } from "@/app/lib/pcb/netclass";
import type { EngineeringDiagnostic } from "@/app/lib/pcb/integrity";
import { engineeringDiagnostic } from "@/app/lib/pcb/integrity";
import { compileConstraintProgram } from "./compiler";
import { boardConstraintTargetRevision, boardConstraintTargets } from "./board-model";
import type {
  BoardConstraintState,
  ConstraintDefinition,
  ConstraintDiagnostic,
  ConstraintDocument,
  ConstraintKind,
  TypedSelector,
} from "./types";
import { constraintSemanticHash, stableConstraintId } from "./stable";

const LEGACY_DOCUMENT_ID = "constraint-set:legacy-board-rules";

function selectorForNumericNets(board: PcbBoard, netIds: number[]): TypedSelector | null {
  const ids = [...new Set(netIds)].map((netId) => board.nets.find((net) => net.id === netId)?.stableId).filter((id): id is string => Boolean(id)).sort();
  return ids.length === 0 ? null : { objectType: "net", predicate: { kind: "ids", ids }, cardinality: { kind: "exactly", count: ids.length } };
}

function selectorForChange(board: PcbBoard, change: RuleDeltaChange): { selector: TypedSelector; proposedInference: boolean } | null {
  if (change.appliesTo.kind === "nets") {
    const selector = selectorForNumericNets(board, change.appliesTo.netIds);
    return selector ? { selector, proposedInference: false } : null;
  }
  if (change.appliesTo.kind === "class") {
    return { selector: { objectType: "net", predicate: { kind: "attribute", field: "classId", operator: "eq", value: change.appliesTo.classId }, cardinality: { kind: "zero_or_more" } }, proposedInference: false };
  }
  const simple = /^\^?[A-Za-z0-9_.:+\-]+(?:\.\*)?\$?$/.test(change.appliesTo.regex);
  if (!simple) return null;
  const pattern = change.appliesTo.regex.replace(/^\^/, "").replace(/\$$/, "").replace(/\.\*/g, "*");
  return { selector: { objectType: "net", predicate: { kind: "name_glob", pattern }, cardinality: { kind: "zero_or_more" } }, proposedInference: true };
}

function rule(input: {
  id: string;
  name: string;
  kind: ConstraintKind;
  valueNm: number;
  selector: TypedSelector;
  sourceId: string;
  sourceRevision: string;
  proposedInference?: boolean;
}): ConstraintDefinition {
  return {
    id: input.id,
    revision: 1,
    name: input.name,
    domain: input.kind === "clearance" || input.kind.startsWith("via_") ? "pcb_geometry" : "routing",
    kind: input.kind,
    scope: { type: "project" },
    selector: input.selector,
    requirement: { form: "minimum", value: { dimension: "length", value: String(input.valueNm), unit: "nm" } },
    strength: input.proposedInference ? "advisory" : "hard",
    severityPolicyId: input.proposedInference ? "severity:review" : "severity:blocking",
    origin: input.proposedInference
      ? { kind: "deterministic_inference", sourceId: input.sourceId, sourceRevision: input.sourceRevision, confidence: 0.4, reviewState: "proposed" }
      : { kind: "legacy_import", sourceId: input.sourceId, sourceRevision: input.sourceRevision },
    evidenceIds: [],
    lifecycle: { state: "active" },
    waiverPolicy: { eligible: false },
  };
}

function classRules(input: { idPrefix: string; classId: NetClassId; selector: TypedSelector; sourceId: string; sourceRevision: string; proposedInference?: boolean }): ConstraintDefinition[] {
  const values = DEFAULT_CLASSES[input.classId];
  return [
    rule({ ...input, id: `${input.idPrefix}:width`, name: `${input.classId} minimum trace width`, kind: "trace_width", valueNm: values.trackWidth }),
    rule({ ...input, id: `${input.idPrefix}:clearance`, name: `${input.classId} minimum clearance`, kind: "clearance", valueNm: values.clearance }),
    rule({ ...input, id: `${input.idPrefix}:via-outer`, name: `${input.classId} minimum via diameter`, kind: "via_diameter", valueNm: values.viaSize }),
    rule({ ...input, id: `${input.idPrefix}:via-drill`, name: `${input.classId} minimum via drill`, kind: "via_drill", valueNm: values.viaDrill }),
  ];
}

export function legacyBoardConstraintDocument(board: PcbBoard): { document: ConstraintDocument; diagnostics: EngineeringDiagnostic[]; sourceHash: string } {
  const source = { netClassing: board.netClassing, routingPreferences: board.routingPreferences, stackupConfig: board.stackupConfig, placementPolicy: board.placementPolicy, placementPreferences: board.placementPreferences };
  const sourceHash = constraintSemanticHash(source);
  const diagnostics: EngineeringDiagnostic[] = [];
  const allNetIds = board.nets.filter((net) => net.id !== 0).map((net) => net.id);
  const allNets = selectorForNumericNets(board, allNetIds) ?? { objectType: "net" as const, predicate: { kind: "all" as const }, cardinality: { kind: "zero_or_more" as const } };
  const constraints = classRules({ idPrefix: "legacy:default", classId: "Default", selector: allNets, sourceId: LEGACY_DOCUMENT_ID, sourceRevision: sourceHash });

  for (const [numericId, assignment] of Object.entries(board.netClassing?.base ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    if (assignment.classId === "Default") continue;
    const selector = selectorForNumericNets(board, [Number(numericId)]);
    if (!selector) continue;
    constraints.push(...classRules({ idPrefix: `inference:net:${numericId}:${assignment.classId.toLowerCase()}`, classId: assignment.classId, selector, sourceId: "legacy-net-classifier", sourceRevision: sourceHash, proposedInference: true }));
  }

  for (const delta of [...(board.netClassing?.ruleDeltas ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const [index, change] of delta.changes.entries()) {
      const resolved = selectorForChange(board, change);
      if (!resolved) {
        diagnostics.push(engineeringDiagnostic("LEGACY_RULE_SELECTOR_UNSUPPORTED", `Legacy rule ${delta.id} change ${index} uses an unsafe or unrepresentable name selector and was not activated.`, { severity: "warning", context: { deltaId: delta.id, changeIndex: index } }));
        continue;
      }
      const idPrefix = `legacy:delta:${delta.id}:${index}`;
      if (change.className) constraints.push(...classRules({ idPrefix: `${idPrefix}:class`, classId: change.className, selector: resolved.selector, sourceId: `legacy-rule-delta:${delta.id}`, sourceRevision: sourceHash, proposedInference: resolved.proposedInference }));
      const numeric: Array<[ConstraintKind, number | undefined]> = [
        ["trace_width" as const, change.trackWidthNm],
        ["clearance" as const, change.clearanceNm],
        ["via_diameter" as const, change.viaSizeNm],
        ["via_drill" as const, change.viaDrillNm],
      ];
      for (const [kind, value] of numeric) if (value !== undefined) constraints.push(rule({ id: `${idPrefix}:${kind}`, name: delta.explanation, kind, valueNm: value, selector: resolved.selector, sourceId: `legacy-rule-delta:${delta.id}`, sourceRevision: sourceHash, proposedInference: resolved.proposedInference }));
    }
  }

  for (const [numericId, assignment] of Object.entries(board.netClassing?.assignments ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    if (!assignment.override) continue;
    const selector = selectorForNumericNets(board, [Number(numericId)]);
    if (!selector) continue;
    const numeric: Array<[ConstraintKind, number | undefined]> = [
      ["trace_width" as const, assignment.override.trackWidth],
      ["clearance" as const, assignment.override.clearance],
      ["via_diameter" as const, assignment.override.viaSize],
      ["via_drill" as const, assignment.override.viaDrill],
    ];
    for (const [kind, value] of numeric) if (value !== undefined) constraints.push(rule({ id: `legacy:assignment:${numericId}:${kind}`, name: `Legacy explicit ${kind}`, kind, valueNm: value, selector, sourceId: `legacy-assignment:${numericId}`, sourceRevision: sourceHash }));
  }

  return {
    document: {
      schemaVersion: 1,
      id: LEGACY_DOCUMENT_ID,
      revision: 1,
      name: "Migrated board rules",
      description: "Idempotent typed compatibility projection of pre-Stage-6 board rule fields.",
      extendsSetIds: [],
      constraints: constraints.sort((a, b) => a.id.localeCompare(b.id)),
      relationships: [],
    },
    diagnostics,
    sourceHash,
  };
}

function toEngineeringDiagnostic(item: ConstraintDiagnostic): EngineeringDiagnostic {
  return engineeringDiagnostic(item.code, item.message, { severity: item.severity, objectIds: item.targetIds, context: { constraintIds: item.constraintIds } });
}

/** Idempotent legacy migration. A failed candidate never replaces the active program. */
export function migrateBoardConstraintState(board: PcbBoard, projectId: string): { board: PcbBoard; diagnostics: EngineeringDiagnostic[] } {
  const migrated = legacyBoardConstraintDocument(board);
  if (board.constraintState?.legacyMigration.sourceHash === migrated.sourceHash && board.constraintState.projectId === projectId) return { board, diagnostics: migrated.diagnostics };
  const existingDocuments = (board.constraintState?.documents ?? []).filter((document) => document.id !== LEGACY_DOCUMENT_ID);
  const documents = [...existingDocuments, migrated.document];
  const result = compileConstraintProgram({
    documents,
    targets: boardConstraintTargets(board, projectId),
    facts: [],
    designRevision: boardConstraintTargetRevision(board, projectId),
    catalogRevision: "catalog:unbound",
    variantRevision: "variant:default",
    manufacturingProfileRevision: "manufacturing:unbound",
    supportRegistry: {},
  });
  if (!result.ok) return { board, diagnostics: [...migrated.diagnostics, ...result.diagnostics.map(toEngineeringDiagnostic)] };
  const next = structuredClone(board);
  const previous = board.constraintState?.activeProgram?.programHash;
  const state: BoardConstraintState = {
    schemaVersion: 1,
    projectId,
    documents,
    activeProgram: result.program,
    waivers: board.constraintState?.waivers ?? [],
    legacyMigration: { version: 1, sourceHash: migrated.sourceHash },
    history: [
      ...(board.constraintState?.history ?? []),
      {
        id: stableConstraintId("constraint-history", { action: "activate", previous, next: result.program.programHash }),
        action: "activate",
        ...(previous ? { fromProgramHash: previous } : {}),
        toProgramHash: result.program.programHash,
        actorId: "migration:stage6",
        programSnapshot: result.program,
        documentSnapshot: documents,
      },
    ],
  };
  next.constraintState = state;
  return { board: next, diagnostics: [...migrated.diagnostics, ...result.diagnostics.map(toEngineeringDiagnostic)] };
}
