import type { EngineeringActor } from "../engineering/types";
import { finalizeVerification, uniqueSorted, verificationId } from "./stable";
import type { CircuitFinding, FullOracleRun } from "./types";

export interface VerificationRemediationProposal {
  proposalId: string;
  graphDigest: string;
  fullRunId: string;
  findingStableIdentities: string[];
  proposedBy: EngineeringActor;
  summary: string;
  proposedActions: Array<{ actionId: string; kind: "inspect_evidence" | "request_external_review" | "propose_schematic_successor" | "rerun_full_oracle"; targetIds: string[]; rationale: string }>;
  authority: "proposal_only_no_design_or_verdict_mutation";
  status: "draft";
  deterministicDigest: string;
}

export const CIRCUIT_VERIFICATION_PROPOSAL_TOOL = {
  name: "propose_circuit_verification_remediation",
  description: "Propose evidence inspection, external review, or a new schematic successor for human review. This tool cannot mutate design truth, waive a finding, or change readiness.",
  schema: {
    type: "object", additionalProperties: false, required: ["findingStableIdentities", "summary", "proposedActions"],
    properties: {
      findingStableIdentities: { type: "array", minItems: 1, maxItems: 256, items: { type: "string", minLength: 1 } },
      summary: { type: "string", minLength: 1, maxLength: 4000 },
      proposedActions: { type: "array", minItems: 1, maxItems: 256, items: { type: "object", additionalProperties: false, required: ["actionId", "kind", "targetIds", "rationale"], properties: { actionId: { type: "string", minLength: 1 }, kind: { enum: ["inspect_evidence", "request_external_review", "propose_schematic_successor", "rerun_full_oracle"] }, targetIds: { type: "array", maxItems: 64, items: { type: "string", minLength: 1 } }, rationale: { type: "string", minLength: 1, maxLength: 2000 } } } },
    },
  },
} as const;

export function createVerificationRemediationProposal(input: { run: FullOracleRun; findings: CircuitFinding[]; actor: EngineeringActor; summary: string; actions: VerificationRemediationProposal["proposedActions"] }): VerificationRemediationProposal {
  const knownTargets = new Set(input.findings.flatMap((item) => item.semanticAnchorIds));
  if (!input.summary.trim() || !input.actions.length || input.findings.some((item) => item.currentRunId !== input.run.runId) || input.actions.some((item) => !item.actionId.trim() || !item.rationale.trim() || item.targetIds.some((id) => !knownTargets.has(id)))) throw new Error("CD9_REMEDIATION_PROPOSAL_INPUT_INVALID");
  const body = { graphDigest: input.run.graphDigest, fullRunId: input.run.runId, findingStableIdentities: uniqueSorted(input.findings.map((item) => item.stableIdentity)), proposedBy: structuredClone(input.actor), summary: input.summary.trim(), proposedActions: structuredClone(input.actions).map((item) => ({ ...item, targetIds: uniqueSorted(item.targetIds) })), authority: "proposal_only_no_design_or_verdict_mutation" as const, status: "draft" as const };
  return finalizeVerification<VerificationRemediationProposal>({ ...body, proposalId: verificationId("verification-remediation-proposal", body), deterministicDigest: "" });
}

export function normalizeVerificationRemediationProposal(input: { raw: { findingStableIdentities: string[]; summary: string; proposedActions: VerificationRemediationProposal["proposedActions"] }; run: FullOracleRun; actor: EngineeringActor }): VerificationRemediationProposal {
  const requested = uniqueSorted(input.raw.findingStableIdentities);
  const findings = requested.map((identity) => input.run.findings.find((item) => item.stableIdentity === identity)).filter((item): item is CircuitFinding => Boolean(item));
  if (findings.length !== requested.length) throw new Error("CD9_AI_PROPOSAL_FINDING_REFERENCE_INVALID");
  return createVerificationRemediationProposal({ run: input.run, findings, actor: input.actor, summary: input.raw.summary, actions: input.raw.proposedActions });
}
