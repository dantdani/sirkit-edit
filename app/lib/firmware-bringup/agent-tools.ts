import type { EngineeringActor } from "../engineering/types";
import { cd11Digest, cd11Id, unique } from "./stable";

export interface Cd11ChangeProposal { proposalId: string; problemDigest: string; kind: "resource_assignment" | "lifecycle_review" | "clock_boot_contract" | "dft_access" | "factory_test" | "calibration" | "diagnostic_scaffolding" | "bringup" | "failure_isolation" | "approval_request"; targetRefs: string[]; actions: Array<{ action: string; rationale: string; typedInputRefs: string[] }>; assumptions: string[]; warnings: string[]; authority: "proposal_only"; proposedBy: EngineeringActor; deterministicDigest: string }
export function createCd11Proposal(input: Omit<Cd11ChangeProposal, "proposalId" | "authority" | "deterministicDigest">): Cd11ChangeProposal { const body = { ...structuredClone(input), targetRefs: unique(input.targetRefs), assumptions: unique(input.assumptions), warnings: unique(input.warnings), authority: "proposal_only" as const }; const proposalId = cd11Id("cd11-proposal", body); return { ...body, proposalId, deterministicDigest: cd11Digest({ ...body, proposalId }) }; }
export function applyCd11Proposal(): never { throw new Error("CD11_PROPOSAL_REQUIRES_HUMAN_REVIEW_AND_AUTHORIZED_TRANSACTION"); }
export function executeRawRegisterWrite(): never { throw new Error("CD11_RAW_REGISTER_WRITE_UNREACHABLE"); }
export function executeRawInstrumentOrProgrammerCommand(): never { throw new Error("CD11_RAW_TOOL_COMMAND_UNREACHABLE"); }
export function authorizeIrreversibleOperation(): never { throw new Error("CD11_IRREVERSIBLE_OPERATION_REQUIRES_SEPARATE_EXTERNAL_HUMAN_AUTHORITY"); }
