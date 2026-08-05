import type { DrcCheckKind, DrcResult } from "@/app/lib/pcb/drc/types";
import type { ConstraintKind, ConstraintProgram, ConstraintViolation } from "./types";
import { stableConstraintId } from "./stable";

/**
 * Constraint kinds whose DRC evidence is identified by the violation KIND
 * rather than per-net rule lineage: these geometry-pair checks measure the
 * SAME preset field the manufacturing constraint compiled from, so any
 * violation of the mapped kind is evidence against every constraint of that
 * kind (conservative over-attribution errs strict, never lenient).
 */
const KIND_EVIDENCE: Partial<Record<ConstraintKind, DrcCheckKind>> = {
  hole_clearance: "holeToHole",
  courtyard_clearance: "courtyardOverlap",
  silk_clearance: "silkOverPad",
};

/** Convert one current DRC result into per-constraint evidence without changing DRC truth. */
export function constraintResultsFromDrc(program: ConstraintProgram, drc: DrcResult): ConstraintViolation[] {
  const constraintIds = new Set(program.coverage.filter((item) => item.consumerId === "pcb-physical-rule-resolver").map((item) => item.constraintId));
  const output: ConstraintViolation[] = [];
  for (const constraintId of [...constraintIds].sort()) {
    const rule = program.effectiveRules.find((item) => item.contributingConstraintIds.includes(constraintId));
    if (!rule) continue;
    const mappedKind = KIND_EVIDENCE[rule.kind];
    const matching = drc.violations.filter((violation) => violation.severity === "error"
      && (violation.constraintIds?.includes(constraintId) || (mappedKind !== undefined && violation.kind === mappedKind)));
    const advisoryWarnings = mappedKind !== undefined
      ? drc.violations.filter((violation) => violation.kind === mappedKind && violation.severity === "warning").length
      : 0;
    const stale = drc.constraintProgramHash !== undefined && drc.constraintProgramHash !== program.programHash;
    const state: ConstraintViolation["state"] = stale ? "stale" : drc.execution !== "completed" ? "not_run" : matching.length > 0 ? "fail" : "pass";
    const message = stale
      ? "DRC was evaluated against a different constraint program."
      : drc.execution !== "completed"
        ? "DRC did not complete."
        : matching.length > 0
          ? `${matching.length} DRC violation(s) reference this effective constraint.`
          : advisoryWarnings > 0
            ? `All blocking DRC measurements for this effective constraint passed; ${advisoryWarnings} advisory warning(s) of kind ${mappedKind} were recorded.`
            : "All implemented DRC measurements for this effective constraint passed.";
    output.push({
      id: stableConstraintId("constraint-result", { constraintId, state, drcRevision: drc.designRevision, matching: matching.map((item) => item.id) }),
      constraintId,
      targetIds: [rule.targetId],
      state,
      consumerId: "pcb-physical-rule-resolver",
      checkerVersion: drc.checkVersion,
      required: rule.requirement,
      evidenceIds: [...rule.evidenceIds],
      message,
      nextAction: state === "pass" ? "No action required." : "Resolve the linked DRC measurements and rerun the complete checker.",
    });
  }
  return output;
}

