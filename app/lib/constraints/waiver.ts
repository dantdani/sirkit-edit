import type { ConstraintProgram, ConstraintViolation, ConstraintWaiver } from "./types";
import { stableConstraintId } from "./stable";

export function createConstraintWaiver(input: {
  program: ConstraintProgram;
  designRevision: string;
  violations: ConstraintViolation[];
  targetIds: string[];
  releaseProfileId: string;
  reason: string;
  actorId: string;
  authorizedBy: string;
  createdAt: string;
  expiresAt?: string;
}): ConstraintWaiver {
  if (input.designRevision !== input.program.designRevision) throw new Error("Cannot waive a stale constraint program.");
  if (input.reason.trim().length < 8) throw new Error("Constraint waiver reason must contain at least 8 characters.");
  if (!input.actorId.trim() || !input.authorizedBy.trim()) throw new Error("Constraint waiver requires actor and independent authorization.");
  if (input.actorId === input.authorizedBy) throw new Error("Constraint waiver authorization must be independent from the requester.");
  if (input.violations.length === 0 || input.violations.some((item) => item.state !== "fail")) throw new Error("A waiver must name one or more proven failed violations.");
  const constraintIds = [...new Set(input.violations.map((item) => item.constraintId))].sort();
  for (const constraintId of constraintIds) {
    const effective = input.program.effectiveRules.find((rule) => rule.contributingConstraintIds.includes(constraintId));
    if (!effective) throw new Error(`Constraint ${constraintId} is not active in the program.`);
    if (!effective.waiverEligible) throw new Error(`Constraint ${constraintId} is non-waivable under its compiled policy.`);
  }
  const body = {
    schemaVersion: 1 as const,
    constraintIds,
    violationIds: input.violations.map((item) => item.id).sort(),
    targetIds: [...new Set(input.targetIds)].sort(),
    designRevision: input.designRevision,
    programHash: input.program.programHash,
    releaseProfileId: input.releaseProfileId,
    reason: input.reason.trim(),
    actorId: input.actorId,
    authorizedBy: input.authorizedBy,
    createdAt: input.createdAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    invalidation: "any_semantic_change" as const,
  };
  return { ...body, id: stableConstraintId("constraint-waiver", body) };
}
