import type { EngineeringActor } from "../engineering/types";
import { cd12Digest, cd12Id, unique } from "./stable";

export type Cd12ProposalKind = "inspect_bom_identity" | "refresh_approved_snapshot" | "procurement_scenario" | "alternate_assessment" | "lifecycle_risk" | "capability_match" | "dfm_dft_review" | "artifact_verification" | "change_exception_review" | "release_level_review" | "human_external_review_request";
export interface Cd12Proposal { proposalId: string; problemDigest: string; kind: Cd12ProposalKind; targetRefs: string[]; typedActions: Array<{ action: string; typedInputRefs: string[]; rationale: string }>; assumptions: string[]; warnings: string[]; authority: "proposal_only"; proposedBy: EngineeringActor; deterministicDigest: string }
export function createCd12Proposal(input: Omit<Cd12Proposal, "proposalId" | "authority" | "deterministicDigest">): Cd12Proposal { if (input.typedActions.length > 128 || input.targetRefs.length > 512) throw new Error("CD12_PROPOSAL_LIMIT_EXCEEDED"); const body = { ...structuredClone(input), targetRefs: unique(input.targetRefs), assumptions: unique(input.assumptions), warnings: unique(input.warnings), authority: "proposal_only" as const }, proposalId = cd12Id("cd12-proposal", body); return { ...body, proposalId, deterministicDigest: cd12Digest({ ...body, proposalId }) }; }
export function applyCd12Proposal(): never { throw new Error("CD12_PROPOSAL_REQUIRES_HUMAN_REVIEW_AND_AUTHORIZED_TRANSACTION"); }
export function writeManufacturingBytesFromLlm(): never { throw new Error("CD12_LLM_CANNOT_WRITE_MANUFACTURING_ARTIFACT_BYTES"); }

