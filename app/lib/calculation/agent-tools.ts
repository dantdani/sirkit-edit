import { calculationDigest, calculationId } from "./stable";

export interface CalculationAnalysisProposal {
  proposalId: string;
  kind: "analysis_plan" | "model_candidate" | "missing_input_questions";
  obligationIds: string[];
  proposedModelRevisionIds: string[];
  explanation: string;
  warnings: string[];
  mayContainNumericResult: false;
  mayApproveEngineeringState: false;
  deterministicDigest: string;
}

export function normalizeCalculationAgentProposal(input: Omit<CalculationAnalysisProposal, "proposalId" | "mayContainNumericResult" | "mayApproveEngineeringState" | "deterministicDigest">): CalculationAnalysisProposal {
  const base = { ...structuredClone(input), proposalId: calculationId("calculation-agent-proposal", input), obligationIds: [...new Set(input.obligationIds)].sort(), proposedModelRevisionIds: [...new Set(input.proposedModelRevisionIds)].sort(), warnings: [...new Set(input.warnings)].sort(), mayContainNumericResult: false as const, mayApproveEngineeringState: false as const };
  return { ...base, deterministicDigest: calculationDigest(base) };
}

export function assertProposalOnlyToolPayload(value: unknown): void {
  const serialized = JSON.stringify(value).toLowerCase();
  if (serialized.includes("selectedvalue") || serialized.includes("constraintmargin") || serialized.includes("approvalstate\":\"approved") || serialized.includes("schematic") || serialized.includes("pcb")) throw new Error("CD7_AGENT_PROPOSAL_AUTHORITY_VIOLATION");
}
