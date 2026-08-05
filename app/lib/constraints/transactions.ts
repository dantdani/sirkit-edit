import type { PcbBoard } from "@/app/lib/pcb/types";
import { markZoneFillDirty } from "@/app/lib/pcb/zones/fill-lifecycle";
import { boardConstraintTargetRevision, boardConstraintTargets } from "./board-model";
import { compileConstraintProgram } from "./compiler";
import { constraintSemanticHash, stableConstraintId } from "./stable";
import type {
  ConstraintCompilationResult,
  ConstraintDocument,
  ConstraintProgram,
  EnforcementCoverage,
} from "./types";

export interface ConstraintTransactionPreview {
  id: string;
  baseProgramHash?: string;
  candidateDocuments: ConstraintDocument[];
  compilation: ConstraintCompilationResult;
  targetChanges: Array<{ constraintId: string; before: string[]; after: string[] }>;
  effectiveRuleChanges: Array<{ ruleId: string; change: "added" | "removed" | "changed"; before?: string; after?: string }>;
  coverageChanges: Array<{ constraintId: string; before?: EnforcementCoverage["support"]; after?: EnforcementCoverage["support"] }>;
}

function comparePrograms(before: ConstraintProgram | undefined, after: ConstraintProgram | undefined): Pick<ConstraintTransactionPreview, "targetChanges" | "effectiveRuleChanges" | "coverageChanges"> {
  const targets = new Set([...(before?.targetSnapshots.map((item) => item.constraintId) ?? []), ...(after?.targetSnapshots.map((item) => item.constraintId) ?? [])]);
  const targetChanges = [...targets].sort().flatMap((constraintId) => {
    const left = before?.targetSnapshots.find((item) => item.constraintId === constraintId)?.targetIds ?? [];
    const right = after?.targetSnapshots.find((item) => item.constraintId === constraintId)?.targetIds ?? [];
    return left.join("\0") === right.join("\0") ? [] : [{ constraintId, before: left, after: right }];
  });
  const beforeRules = new Map(before?.effectiveRules.map((item) => [item.id, constraintSemanticHash(item)]) ?? []);
  const afterRules = new Map(after?.effectiveRules.map((item) => [item.id, constraintSemanticHash(item)]) ?? []);
  const ruleIds = new Set([...beforeRules.keys(), ...afterRules.keys()]);
  const effectiveRuleChanges = [...ruleIds].sort().flatMap((ruleId) => {
    const left = beforeRules.get(ruleId);
    const right = afterRules.get(ruleId);
    if (left === right) return [];
    return [{ ruleId, change: left === undefined ? "added" as const : right === undefined ? "removed" as const : "changed" as const, ...(left ? { before: left } : {}), ...(right ? { after: right } : {}) }];
  });
  const beforeCoverage = new Map(before?.coverage.map((item) => [item.constraintId, item.support]) ?? []);
  const afterCoverage = new Map(after?.coverage.map((item) => [item.constraintId, item.support]) ?? []);
  const coverageIds = new Set([...beforeCoverage.keys(), ...afterCoverage.keys()]);
  const coverageChanges = [...coverageIds].sort().flatMap((constraintId) => {
    const left = beforeCoverage.get(constraintId);
    const right = afterCoverage.get(constraintId);
    return left === right ? [] : [{ constraintId, ...(left ? { before: left } : {}), ...(right ? { after: right } : {}) }];
  });
  return { targetChanges, effectiveRuleChanges, coverageChanges };
}

export function previewConstraintTransaction(input: {
  board: PcbBoard;
  projectId: string;
  documents: ConstraintDocument[];
  catalogRevision?: string;
  variantRevision?: string;
  manufacturingProfileRevision?: string;
}): ConstraintTransactionPreview {
  const compilation = compileConstraintProgram({
    documents: input.documents,
    targets: boardConstraintTargets(input.board, input.projectId),
    facts: [],
    designRevision: boardConstraintTargetRevision(input.board, input.projectId),
    catalogRevision: input.catalogRevision ?? input.board.constraintState?.activeProgram?.catalogRevision ?? "catalog:unbound",
    variantRevision: input.variantRevision ?? input.board.constraintState?.activeProgram?.variantRevision ?? "variant:default",
    manufacturingProfileRevision: input.manufacturingProfileRevision ?? input.board.constraintState?.activeProgram?.manufacturingProfileRevision ?? "manufacturing:unbound",
    supportRegistry: {},
  });
  const after = compilation.ok ? compilation.program : undefined;
  const changes = comparePrograms(input.board.constraintState?.activeProgram, after);
  return {
    id: stableConstraintId("constraint-preview", { base: input.board.constraintState?.activeProgram?.programHash, candidate: compilation.ok ? compilation.program.programHash : compilation.candidateHash }),
    ...(input.board.constraintState?.activeProgram ? { baseProgramHash: input.board.constraintState.activeProgram.programHash } : {}),
    candidateDocuments: structuredClone(input.documents),
    compilation,
    ...changes,
  };
}

export type ApplyConstraintTransactionResult =
  | { ok: true; board: PcbBoard; program: ConstraintProgram }
  | { ok: false; code: "INVALID_CANDIDATE" | "STALE_BASE" | "STALE_TARGETS"; message: string };

/** Compare-and-commit. Invalid or stale candidates cannot partially activate. */
export function applyConstraintTransaction(input: {
  board: PcbBoard;
  projectId: string;
  preview: ConstraintTransactionPreview;
  actorId: string;
}): ApplyConstraintTransactionResult {
  if (!input.preview.compilation.ok) return { ok: false, code: "INVALID_CANDIDATE", message: "The candidate did not compile; no constraint source or consumer was changed." };
  const currentHash = input.board.constraintState?.activeProgram?.programHash;
  if (currentHash !== input.preview.baseProgramHash) return { ok: false, code: "STALE_BASE", message: "The active constraint program changed after preview." };
  const program = input.preview.compilation.program;
  if (program.designRevision !== boardConstraintTargetRevision(input.board, input.projectId)) return { ok: false, code: "STALE_TARGETS", message: "Constraint target identities changed after preview." };
  const board = structuredClone(input.board);
  const previous = board.constraintState?.activeProgram?.programHash;
  const history = board.constraintState?.history ?? [];
  board.constraintState = {
    schemaVersion: 1,
    projectId: input.projectId,
    documents: structuredClone(input.preview.candidateDocuments),
    activeProgram: program,
    waivers: board.constraintState?.waivers ?? [],
    legacyMigration: board.constraintState?.legacyMigration ?? { version: 1, sourceHash: "not-migrated" },
    history: [...history, {
      id: stableConstraintId("constraint-history", { action: "activate", previous, next: program.programHash, actorId: input.actorId }),
      action: "activate" as const,
      ...(previous ? { fromProgramHash: previous } : {}),
      toProgramHash: program.programHash,
      actorId: input.actorId,
      programSnapshot: program,
      documentSnapshot: structuredClone(input.preview.candidateDocuments),
    }].slice(-100),
  };
  for (const zone of board.zones) markZoneFillDirty(zone, `constraint-program:${program.programHash}`);
  return { ok: true, board, program };
}

export function revertConstraintProgram(input: { board: PcbBoard; programHash: string; actorId: string }): ApplyConstraintTransactionResult {
  const snapshot = [...(input.board.constraintState?.history ?? [])].reverse().find((item) => item.toProgramHash === input.programHash && item.programSnapshot && item.documentSnapshot);
  if (!snapshot?.programSnapshot || !snapshot.documentSnapshot) return { ok: false, code: "INVALID_CANDIDATE", message: "The requested historical program snapshot is unavailable." };
  const board = structuredClone(input.board);
  const previous = board.constraintState?.activeProgram?.programHash;
  board.constraintState = {
    ...board.constraintState!,
    documents: structuredClone(snapshot.documentSnapshot),
    activeProgram: snapshot.programSnapshot,
    activeEvaluation: undefined,
    history: [...board.constraintState!.history, {
      id: stableConstraintId("constraint-history", { action: "revert", previous, next: snapshot.toProgramHash, actorId: input.actorId }),
      action: "revert" as const,
      ...(previous ? { fromProgramHash: previous } : {}),
      toProgramHash: snapshot.toProgramHash,
      actorId: input.actorId,
      programSnapshot: snapshot.programSnapshot,
      documentSnapshot: structuredClone(snapshot.documentSnapshot),
    }].slice(-100),
  };
  for (const zone of board.zones) markZoneFillDirty(zone, `constraint-program:${snapshot.toProgramHash}`);
  return { ok: true, board, program: snapshot.programSnapshot };
}
