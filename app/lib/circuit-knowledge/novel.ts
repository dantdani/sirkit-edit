import type { EngineeringActor } from "../engineering/types";
import { circuitDigest, circuitId } from "./stable";
import type { NovelCircuitDesignProposal } from "./types";

export function createNovelCircuitDesignProposal(input: Omit<NovelCircuitDesignProposal, "proposalId" | "approvalState" | "publicationCandidateState" | "deterministicDigest"> & { proposalId?: string }): NovelCircuitDesignProposal {
  if (!input.architectureObligationIds.length || !input.sourceEvidenceRefs.length || !input.unsupportedUnknownIds.length || !input.expertReviewRequirements.length || !input.prototypeSimulationTestPlan.length || !input.projectRestriction.trim()) throw new Error("NOVEL_CIRCUIT_PROPOSAL_GOVERNANCE_INCOMPLETE");
  const base = structuredClone({ ...input, proposalId: input.proposalId ?? circuitId("novel-circuit", input), approvalState: "quarantined" as const, publicationCandidateState: "not_eligible" as const });
  return { ...base, deterministicDigest: circuitDigest(base) };
}

export function promoteNovelProposalForProject(proposalInput: NovelCircuitDesignProposal, actor: EngineeringActor): NovelCircuitDesignProposal {
  if (actor.actorKind !== "human" || !["reviewer", "project_admin"].includes(actor.role)) throw new Error("NOVEL_CIRCUIT_HUMAN_REVIEW_REQUIRED");
  if (!proposalInput.expertReviewRequirements.length || !proposalInput.prototypeSimulationTestPlan.length || !proposalInput.projectRestriction.trim()) throw new Error("NOVEL_CIRCUIT_REVIEW_PLAN_INCOMPLETE");
  const proposal = structuredClone(proposalInput);
  proposal.approvalState = "project_restricted_reviewed";
  proposal.publicationCandidateState = "not_eligible";
  proposal.deterministicDigest = circuitDigest({ ...proposal, deterministicDigest: undefined });
  return proposal;
}

export function aiMayMutateCircuitTruth(actor: EngineeringActor): false { void actor; return false; }
