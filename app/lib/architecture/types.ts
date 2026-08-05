import type { ProjectRevision, EngineeringActor } from "../engineering/types";
import type {
  Assumption,
  CapabilityAssessment,
  DesignRequirementsPackage,
  Requirement,
  RequirementPredicate,
  VerificationObligation,
} from "../requirements/types";

export const ARCHITECTURE_SCHEMA_VERSION = "sirkit.architecture.v1" as const;
export const ARCHITECTURE_PROBLEM_SCHEMA_VERSION = "sirkit.architecture-problem.v1" as const;
export const ARCHITECTURE_PROPOSAL_SCHEMA_VERSION = "sirkit.architecture-proposal.v1" as const;
export const ARCHITECTURE_TRANSACTION_SCHEMA_VERSION = "sirkit.architecture-transaction.v1" as const;
export const ARCHITECTURE_COMPILER_VERSION = "sirkit-architecture/1.0.0" as const;
export const ARCHITECTURE_PATTERN_REGISTRY_VERSION = "sirkit-architecture-patterns/1.0.0" as const;
export const ARCHITECTURE_SCORING_VERSION = "sirkit-architecture-scoring/1.0.0" as const;

export type ArchitectureEvidenceState =
  | "pass"
  | "fail"
  | "unknown"
  | "unsupported"
  | "not_evaluated"
  | "stale"
  | "external_review_planned";

export type ArchitectureFlowKind = "power" | "energy" | "analog" | "data" | "control" | "clock" | "reset" | "debug" | "thermal" | "mechanical";
export type ArchitecturePortDirection = "input" | "output" | "bidirectional";
export type ArchitectureCandidateStatus = "proposed" | "invalid" | "infeasible" | "feasible_with_unresolved" | "feasible_for_review" | "selected" | "rejected" | "stale" | "superseded";
export type ArchitectureCoverageState = "direct" | "decomposed" | "delegated" | "external" | "partial" | "uncovered" | "contradicted" | "unsupported" | "not_applicable" | "unknown";
export type ArchitectureOwnerKind = "system" | "hardware" | "firmware" | "software" | "mechanical" | "manufacturing" | "external_authority" | "user";

export interface ArchitectureDiagnostic {
  diagnosticId: string;
  code: string;
  severity: "info" | "warning" | "error" | "blocking";
  message: string;
  objectRefs: string[];
  requirementRefs: string[];
  nextActions: string[];
}

export interface ArchitectureProblemRequirement {
  requirementId: string;
  revision: number;
  statement: string;
  domain: Requirement["domain"];
  strength: Requirement["strength"];
  criticality: Requirement["criticality"];
  predicate: RequirementPredicate;
  subjectRoles: string[];
  capabilityAssessment: CapabilityAssessment;
  verificationObligationRefs: string[];
  sourceRefs: string[];
}

export interface RequiredFunctionalCapability {
  capabilityId: string;
  role: string;
  requirementRefs: string[];
  requiredInteractions: string[];
}

export interface RequiredExternalInteraction {
  interactionId: string;
  externalRole: string;
  flowKind: ArchitectureFlowKind | "unspecified";
  direction: ArchitecturePortDirection;
  requirementRefs: string[];
  knownContract: RequirementPredicate | null;
}

export interface ArchitectureBudget {
  budgetId: string;
  dimension: string;
  predicate: RequirementPredicate;
  requirementRefs: string[];
  allocationState: "unallocated";
}

export interface ArchitectureProblem {
  schemaVersion: typeof ARCHITECTURE_PROBLEM_SCHEMA_VERSION;
  problemId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  requirementsPackageRef: { packageId: string; revision: number; digest: string; status: DesignRequirementsPackage["status"] };
  selectedCapabilityProfileRefs: string[];
  requirements: ArchitectureProblemRequirement[];
  functionalCapabilities: RequiredFunctionalCapability[];
  externalInteractions: RequiredExternalInteraction[];
  budgets: ArchitectureBudget[];
  acceptedAssumptions: Assumption[];
  verificationObligations: VerificationObligation[];
  requiredModeVocabulary: string[];
  unresolvedNonBlockingItems: string[];
  compilerVersion: typeof ARCHITECTURE_COMPILER_VERSION;
  deterministicDigest: string;
}

export type CompileArchitectureProblemResult =
  | { ok: true; problem: ArchitectureProblem; diagnostics: ArchitectureDiagnostic[] }
  | { ok: false; diagnostics: ArchitectureDiagnostic[] };

/** Strict provider-neutral structure an LLM may propose. No parts, pins, nets, footprints, or values. */
export interface ArchitectureCandidateProposal {
  schemaVersion: typeof ARCHITECTURE_PROPOSAL_SCHEMA_VERSION;
  proposalId: string;
  problemDigest: string;
  lineageId: string;
  title: string;
  summary: string;
  patternRefs: string[];
  blocks: ArchitectureBlockProposal[];
  ports: ArchitecturePortProposal[];
  flows: ArchitectureFlowProposal[];
  modes: ArchitectureModeProposal[];
  transitions: ArchitectureTransitionProposal[];
  domains: ArchitectureDomainProposal[];
  boundaries: ArchitectureBoundaryProposal[];
  responsibilities: ArchitectureResponsibilityProposal[];
  resources: ArchitectureResourceEnvelopeProposal[];
  risks: ArchitectureRiskProposal[];
  architectureQuestions: ArchitectureQuestionProposal[];
  assumptions: string[];
}

export interface ArchitectureBlockProposal {
  localId: string;
  parentLocalId: string | null;
  role: string;
  label: string;
  description: string;
  requirementRefs: string[];
  patternRuleRefs: string[];
  ownerKind: ArchitectureOwnerKind;
}

export interface ArchitecturePortProposal {
  localId: string;
  blockLocalId: string;
  role: string;
  label: string;
  direction: ArchitecturePortDirection;
  flowKind: ArchitectureFlowKind;
  required: boolean;
  requirementRefs: string[];
}

export interface ArchitectureFlowProposal {
  localId: string;
  role: string;
  label: string;
  flowKind: ArchitectureFlowKind;
  producerPortLocalId: string;
  consumerPortLocalIds: string[];
  requirementRefs: string[];
  modeLocalIds: string[];
  dependencyClass: "normal" | "bootstrap" | "fault_response";
}

export interface ArchitectureModeProposal {
  localId: string;
  label: string;
  description: string;
  initial: boolean;
  safeState: boolean;
  terminal: boolean;
  requirementRefs: string[];
}

export interface ArchitectureTransitionProposal {
  localId: string;
  fromModeLocalId: string;
  toModeLocalId: string;
  trigger: string;
  guard: string | null;
  response: string;
  requirementRefs: string[];
}

export interface ArchitectureDomainProposal {
  localId: string;
  kind: "power" | "clock" | "reset" | "trust" | "thermal" | "mechanical" | "ownership";
  label: string;
  blockLocalIds: string[];
  requirementRefs: string[];
}

export interface ArchitectureBoundaryProposal {
  localId: string;
  kind: "isolation" | "protection" | "trust" | "thermal" | "mechanical" | "organizational";
  label: string;
  domainLocalIds: string[];
  crossingFlowLocalIds: string[];
  requirementRefs: string[];
}

export interface ArchitectureResponsibilityProposal {
  localId: string;
  role: string;
  ownerKind: ArchitectureOwnerKind;
  blockLocalIds: string[];
  requirementRefs: string[];
  verificationObligationRefs: string[];
}

export interface ArchitectureResourceEnvelopeProposal {
  localId: string;
  blockLocalId: string;
  dimension: "power" | "energy" | "cost" | "area" | "latency" | "bandwidth" | "thermal" | "memory" | "compute" | "io";
  allocation: RequirementPredicate | null;
  evidenceState: ArchitectureEvidenceState;
  rationale: string;
  requirementRefs: string[];
}

export interface ArchitectureRiskProposal {
  localId: string;
  category: "feasibility" | "integration" | "verification" | "safety" | "schedule" | "sourcing" | "complexity";
  description: string;
  likelihood: "low" | "medium" | "high" | "unknown";
  impact: "low" | "medium" | "high" | "critical";
  mitigation: string;
  requirementRefs: string[];
}

export interface ArchitectureQuestionProposal {
  localId: string;
  question: string;
  blocking: boolean;
  requirementRefs: string[];
}

export interface ArchitecturePatternDefinition {
  patternId: string;
  version: string;
  title: string;
  intent: string;
  applicability: string[];
  requiredRoles: string[];
  optionalRoles: string[];
  requiredFlowKinds: ArchitectureFlowKind[];
  consequences: string[];
  riskPrompts: string[];
  sourceRefs: string[];
  deterministicDigest: string;
}

export interface ArchitectureBlock extends Omit<ArchitectureBlockProposal, "localId" | "parentLocalId"> { blockId: string; parentBlockId: string | null; }
export interface ArchitecturePort extends Omit<ArchitecturePortProposal, "localId" | "blockLocalId"> { portId: string; blockId: string; }
export interface ArchitectureFlow extends Omit<ArchitectureFlowProposal, "localId" | "producerPortLocalId" | "consumerPortLocalIds" | "modeLocalIds"> { flowId: string; producerPortId: string; consumerPortIds: string[]; modeIds: string[]; }
export interface ArchitectureMode extends Omit<ArchitectureModeProposal, "localId"> { modeId: string; }
export interface ArchitectureTransition extends Omit<ArchitectureTransitionProposal, "localId" | "fromModeLocalId" | "toModeLocalId"> { transitionId: string; fromModeId: string; toModeId: string; }
export interface ArchitectureDomain extends Omit<ArchitectureDomainProposal, "localId" | "blockLocalIds"> { domainId: string; blockIds: string[]; }
export interface ArchitectureBoundary extends Omit<ArchitectureBoundaryProposal, "localId" | "domainLocalIds" | "crossingFlowLocalIds"> { boundaryId: string; domainIds: string[]; crossingFlowIds: string[]; }
export interface ArchitectureResponsibility extends Omit<ArchitectureResponsibilityProposal, "localId" | "blockLocalIds"> { responsibilityId: string; blockIds: string[]; }
export interface ArchitectureResourceEnvelope extends Omit<ArchitectureResourceEnvelopeProposal, "localId" | "blockLocalId"> { resourceId: string; blockId: string; }
export interface ArchitectureRisk extends Omit<ArchitectureRiskProposal, "localId"> { riskId: string; }
export interface ArchitectureQuestion extends Omit<ArchitectureQuestionProposal, "localId"> { questionId: string; status: "open" | "answered" | "waived"; }

export interface ArchitectureCoverageRow {
  requirementId: string;
  requirementRevision: number;
  strength: Requirement["strength"];
  state: ArchitectureCoverageState;
  artifactRefs: string[];
  explanation: string;
  verificationObligationRefs: string[];
}

export interface ArchitectureFeasibilityCheck {
  checkId: string;
  category: "structure" | "requirements" | "capability" | "resource" | "dependency" | "external" | "state_machine";
  state: ArchitectureEvidenceState;
  hard: boolean;
  explanation: string;
  objectRefs: string[];
  requirementRefs: string[];
}

export interface ArchitectureObjectiveMetric {
  objectiveId: string;
  label: string;
  direction: "minimize" | "maximize";
  rawValue: number | null;
  range: { min: number; max: number } | null;
  unit: string;
  evidenceState: ArchitectureEvidenceState;
  method: string;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
}

export interface ArchitectureDownstreamObligation {
  obligationId: string;
  targetStage: "CD-3" | "CD-4" | "Stage-6";
  kind: string;
  roleRefs: string[];
  sourceArtifactRefs: string[];
  requirementRefs: string[];
  state: "proposed_not_active";
  description: string;
}

export interface ArchitectureProvenance {
  problemDigest: string;
  requirementsPackageDigest: string;
  patternRegistryVersion: string;
  compilerVersion: string;
  proposalDigest: string;
  provider?: string;
  model?: string;
  promptDigest?: string;
  toolSchemaDigest?: string;
  createdBy: EngineeringActor;
  createdAt: string;
}

export interface SystemArchitectureCandidate {
  schemaVersion: typeof ARCHITECTURE_SCHEMA_VERSION;
  candidateId: string;
  projectId: string;
  branchId: string;
  lineageId: string;
  revision: number;
  title: string;
  summary: string;
  status: ArchitectureCandidateStatus;
  patternRefs: string[];
  blocks: ArchitectureBlock[];
  ports: ArchitecturePort[];
  flows: ArchitectureFlow[];
  modes: ArchitectureMode[];
  transitions: ArchitectureTransition[];
  domains: ArchitectureDomain[];
  boundaries: ArchitectureBoundary[];
  responsibilities: ArchitectureResponsibility[];
  resources: ArchitectureResourceEnvelope[];
  risks: ArchitectureRisk[];
  architectureQuestions: ArchitectureQuestion[];
  coverage: ArchitectureCoverageRow[];
  feasibility: ArchitectureFeasibilityCheck[];
  objectives: ArchitectureObjectiveMetric[];
  downstreamObligations: ArchitectureDownstreamObligation[];
  assumptions: string[];
  diagnostics: ArchitectureDiagnostic[];
  structuralSignature: string;
  provenance: ArchitectureProvenance;
  deterministicDigest: string;
}

export interface ArchitectureDecisionProfile {
  profileId: string;
  version: string;
  weights: Record<string, number>;
  missingDataPolicy: "exclude_objective" | "worst_case_bound";
  deterministicDigest: string;
}

export interface ArchitectureComparisonRow {
  candidateId: string;
  feasible: boolean;
  paretoRank: number | null;
  weightedScore: number | null;
  normalizedObjectives: Record<string, number | null>;
  uncertaintyCount: number;
  hardFailureCount: number;
}

export interface ArchitectureComparison {
  comparisonId: string;
  problemDigest: string;
  candidateDigests: string[];
  decisionProfileRef: string | null;
  rows: ArchitectureComparisonRow[];
  dominanceEdges: Array<{ dominatorCandidateId: string; dominatedCandidateId: string }>;
  sensitivity: Array<{ objectiveId: string; excluded: boolean; explanation: string }>;
  deterministicDigest: string;
}

export interface ArchitectureSelectionDecision {
  decisionId: string;
  candidateId: string;
  candidateDigest: string;
  problemDigest: string;
  approver: EngineeringActor;
  rationale: string;
  consideredCandidateIds: string[];
  acceptedRisks: string[];
  unresolvedQuestionIds: string[];
  createdAt: string;
  deterministicDigest: string;
}

export interface ArchitectureProjectState {
  schemaVersion: typeof ARCHITECTURE_SCHEMA_VERSION;
  projectId: string;
  branchId: string;
  problem: ArchitectureProblem;
  candidates: SystemArchitectureCandidate[];
  comparisons: ArchitectureComparison[];
  selection: ArchitectureSelectionDecision | null;
  transactionRecords: ArchitectureTransactionRecord[];
  deterministicDigest: string;
}

export type ArchitectureOperation =
  | { operationId: string; kind: "add_candidate"; candidate: SystemArchitectureCandidate }
  | { operationId: string; kind: "remove_candidate"; candidateId: string; expectedCandidateDigest: string }
  | { operationId: string; kind: "replace_candidate"; expectedCandidateDigest: string; candidate: SystemArchitectureCandidate }
  | { operationId: string; kind: "reject_candidate"; candidateId: string; expectedCandidateDigest: string; reason: string }
  | { operationId: string; kind: "record_comparison"; comparison: ArchitectureComparison }
  | { operationId: string; kind: "remove_comparison"; comparisonId: string; expectedComparisonDigest: string }
  | { operationId: string; kind: "select_candidate"; decision: ArchitectureSelectionDecision }
  | { operationId: string; kind: "clear_selection"; expectedDecisionDigest: string; reason: string };

export interface ArchitectureTransaction {
  schemaVersion: typeof ARCHITECTURE_TRANSACTION_SCHEMA_VERSION;
  transactionId: string;
  projectId: string;
  branchId: string;
  actor: EngineeringActor;
  reason: string;
  baseStateDigest: string;
  baseProjectRevision?: ProjectRevision;
  operations: ArchitectureOperation[];
  provenance: { source: "ui" | "api" | "ai" | "migration" | "collaboration"; candidateId?: string };
  createdAt: string;
  deterministicDigest: string;
}

export interface ArchitectureTransactionRecord {
  transaction: ArchitectureTransaction;
  state: "accepted" | "rejected" | "conflict" | "undone";
  resultStateDigest?: string;
  diagnostics: string[];
  inverseOperations: ArchitectureOperation[];
  integrityDigest: string;
}

export interface ArchitectureCompileInput {
  problem: ArchitectureProblem;
  proposal: ArchitectureCandidateProposal;
  projectRevision?: ProjectRevision;
  actor: EngineeringActor;
  createdAt: string;
  provider?: string;
  model?: string;
  promptDigest?: string;
  toolSchemaDigest?: string;
}

export type ArchitectureCompileResult =
  | { ok: true; candidate: SystemArchitectureCandidate }
  | { ok: false; diagnostics: ArchitectureDiagnostic[] };
