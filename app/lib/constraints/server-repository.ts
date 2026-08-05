import { getDb } from "@/app/lib/db/client";
import {
  constraintEvaluations,
  constraintProgramActivations,
  constraintPrograms,
  constraintSetRevisions,
  constraintWaivers,
} from "@/app/lib/db/schema";
import type { ConstraintDocument, ConstraintEvaluationReport, ConstraintProgram, ConstraintWaiver } from "./types";
import { constraintProgramIntegrityErrors } from "./compiler";
import { constraintSemanticHash, stableConstraintId } from "./stable";

function validDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${field} timestamp.`);
  return date;
}

export function validateConstraintProgramPersistence(program: ConstraintProgram, documents: ConstraintDocument[]): void {
  const integrity = constraintProgramIntegrityErrors(program);
  if (integrity.length > 0) throw new Error(`Constraint program integrity failed: ${integrity.join("; ")}`);
  const sourceRevisions = documents.map((document) => ({ id: document.id, revision: document.revision })).sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(sourceRevisions) !== JSON.stringify(program.sourceSetRevisions)) throw new Error("Constraint source-set revisions do not match the compiled program.");
}

/** Persist immutable sources/program and append activation in one PostgreSQL transaction. */
export async function persistConstraintProgramActivation(input: {
  projectId: string;
  documents: ConstraintDocument[];
  program: ConstraintProgram;
  previousProgramHash?: string;
  actorId: string;
  action: "activate" | "revert";
}): Promise<{ activationId: string }> {
  validateConstraintProgramPersistence(input.program, input.documents);
  if (!input.actorId.trim()) throw new Error("Constraint activation actor is required.");
  const createdAt = new Date();
  const activationId = stableConstraintId("constraint-activation", { projectId: input.projectId, programHash: input.program.programHash, previous: input.previousProgramHash, actorId: input.actorId, action: input.action, createdAt: createdAt.toISOString() });
  await getDb().transaction(async (tx) => {
    for (const document of input.documents) await tx.insert(constraintSetRevisions).values({
      id: document.id,
      revision: document.revision,
      schemaVersion: document.schemaVersion,
      semanticHash: constraintSemanticHash(document),
      document,
    }).onConflictDoNothing();
    await tx.insert(constraintPrograms).values({
      programHash: input.program.programHash,
      projectId: input.projectId,
      designRevision: input.program.designRevision,
      catalogRevision: input.program.catalogRevision,
      variantRevision: input.program.variantRevision,
      manufacturingProfileRevision: input.program.manufacturingProfileRevision,
      compilerVersion: input.program.compilerVersion,
      mergePolicyVersion: input.program.mergePolicyVersion,
      program: input.program,
    }).onConflictDoNothing();
    await tx.insert(constraintProgramActivations).values({
      id: activationId,
      projectId: input.projectId,
      programHash: input.program.programHash,
      previousProgramHash: input.previousProgramHash,
      actorId: input.actorId,
      action: input.action,
      createdAt,
    });
  });
  return { activationId };
}

export async function persistConstraintEvaluation(report: ConstraintEvaluationReport): Promise<void> {
  if (report.evaluationHash !== constraintSemanticHash({ ...report, evaluationHash: undefined })) throw new Error("Constraint evaluation semantic hash mismatch.");
  await getDb().insert(constraintEvaluations).values({
    evaluationHash: report.evaluationHash,
    programHash: report.programHash,
    designRevision: report.designRevision,
    readinessState: report.readinessState,
    report,
  }).onConflictDoNothing();
}

export async function persistConstraintWaiver(waiver: ConstraintWaiver): Promise<void> {
  if (!waiver.actorId.trim() || !waiver.authorizedBy.trim() || waiver.actorId === waiver.authorizedBy) throw new Error("Constraint waiver lacks independent authorization.");
  await getDb().insert(constraintWaivers).values({
    id: waiver.id,
    programHash: waiver.programHash,
    designRevision: waiver.designRevision,
    releaseProfileId: waiver.releaseProfileId,
    actorId: waiver.actorId,
    authorizedBy: waiver.authorizedBy,
    expiresAt: waiver.expiresAt ? validDate(waiver.expiresAt, "waiver expiry") : undefined,
    waiver,
    createdAt: validDate(waiver.createdAt, "waiver creation"),
  });
}

