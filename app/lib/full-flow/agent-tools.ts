import type { EngineeringActor } from "../engineering/types";
import { cd13Digest, cd13Id, unique } from "./stable";

export type Cd13ProposalKind = "question" | "assumption" | "decision" | "orchestration_plan" | "stage_evaluation" | "candidate_comparison" | "backtrack" | "human_gate" | "verdict_explanation";
export interface Cd13Proposal { proposalId: string; runRef: string; stateDigest: string; kind: Cd13ProposalKind; targetRefs: string[]; typedPayload: Record<string, string | number | boolean | string[]>; rationale: string; evidenceRefs: string[]; authority: "proposal_only"; proposedBy: EngineeringActor; deterministicDigest: string }
export function createCd13Proposal(input: Omit<Cd13Proposal, "proposalId" | "authority" | "deterministicDigest">): Cd13Proposal { if (!input.runRef || !input.stateDigest || !input.rationale || input.targetRefs.length > 512 || Object.keys(input.typedPayload).length > 128) throw new Error("CD13_PROPOSAL_INVALID_OR_TOO_LARGE"); const body = { ...structuredClone(input), targetRefs: unique(input.targetRefs), evidenceRefs: unique(input.evidenceRefs), authority: "proposal_only" as const }, proposalId = cd13Id("cd13-proposal", body); return { ...body, proposalId, deterministicDigest: cd13Digest({ ...body, proposalId }) }; }
export function commitCd13ProposalDirectly(): never { throw new Error("CD13_PROPOSAL_REQUIRES_DETERMINISTIC_POLICY_AND_OWNING_STAGE"); }
export function arbitraryToolCall(): never { throw new Error("CD13_GENERIC_SHELL_FILE_NETWORK_DATABASE_TOOL_UNREACHABLE"); }
export function externalSideEffect(): never { throw new Error("CD13_EXTERNAL_SIDE_EFFECT_REQUIRES_SEPARATE_AUTHORIZED_WORKFLOW"); }
export function llmApproval(): never { throw new Error("CD13_LLM_CANNOT_APPROVE_ASSUMPTION_TRADEOFF_WAIVER_ALTERNATE_OR_RELEASE"); }

