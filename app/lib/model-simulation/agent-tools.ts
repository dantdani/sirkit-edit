import type { EngineeringActor } from "../engineering/types";
import { simulationDigest, simulationId, unique } from "./stable";

export interface SimulationChangeProposal { proposalId: string; authority: "proposal_only"; problemDigest: string; proposalKind: "model_binding" | "testbench" | "measurement" | "assertion" | "scenario" | "diagnostic"; targetRefs: string[]; proposedActions: Array<{ action: string; rationale: string }>; assumptions: string[]; warnings: string[]; proposedBy: EngineeringActor; deterministicDigest: string }
export function createSimulationChangeProposal(input: Omit<SimulationChangeProposal, "proposalId" | "authority" | "deterministicDigest">): SimulationChangeProposal { const body = { ...structuredClone(input), targetRefs: unique(input.targetRefs), assumptions: unique(input.assumptions), warnings: unique(input.warnings), authority: "proposal_only" as const }; const proposalId = simulationId("simulation-proposal", body); return { ...body, proposalId, deterministicDigest: simulationDigest({ ...body, proposalId }) }; }
export function applySimulationProposal(): never { throw new Error("CD10_AGENT_PROPOSAL_REQUIRES_HUMAN_REVIEW_AND_TRANSACTION"); }
