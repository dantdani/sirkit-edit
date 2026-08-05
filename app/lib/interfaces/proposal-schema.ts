import { getProtocolPattern } from "./protocols";
import { interfaceDigest } from "./stable";
import type { InterfaceDiagnostic, InterfacePlanningProblem } from "./types";

export interface InterfacePlanningProposal {
  schemaVersion: "sirkit.interface-planning-proposal.v1";
  proposalId: string;
  problemDigest: string;
  title: string;
  summary: string;
  choices: Array<{ architectureFlowId: string; protocolClass: string; topologyClass: "point_to_point" | "multidrop" | "multi_controller" | "daisy_chain" | "star" | "broadcast" | "external_proprietary"; resourcePartition: "shared_controller" | "separate_controllers" | "direct_resource"; rationale: string }>;
  assumptions: string[];
  questions: string[];
  deterministicDigest: string;
}

export const INTERFACE_PROPOSAL_TOOL_NAME = "submit_interface_planning_proposal";
export const INTERFACE_PROPOSAL_SYSTEM_INSTRUCTIONS = `You propose one CD-4 logical interface-planning alternative. Use only the supplied immutable problem and governed protocol classes. Return the typed tool payload. Do not choose a manufacturer part, package, terminal, pin number, alternate function, circuit value, net name, coordinate, firmware implementation, or claim electrical/timing/SI/compliance success. Unknowns remain questions. A human selects; deterministic code validates.`;
export const INTERFACE_PROPOSAL_JSON_SCHEMA = {
  name: INTERFACE_PROPOSAL_TOOL_NAME,
  schema: {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "proposalId", "problemDigest", "title", "summary", "choices", "assumptions", "questions"],
    properties: {
      schemaVersion: { const: "sirkit.interface-planning-proposal.v1" }, proposalId: { type: "string" }, problemDigest: { type: "string" }, title: { type: "string" }, summary: { type: "string" },
      choices: { type: "array", items: { type: "object", additionalProperties: false, required: ["architectureFlowId", "protocolClass", "topologyClass", "resourcePartition", "rationale"], properties: { architectureFlowId: { type: "string" }, protocolClass: { type: "string" }, topologyClass: { enum: ["point_to_point", "multidrop", "multi_controller", "daisy_chain", "star", "broadcast", "external_proprietary"] }, resourcePartition: { enum: ["shared_controller", "separate_controllers", "direct_resource"] }, rationale: { type: "string" } } } },
      assumptions: { type: "array", items: { type: "string" } }, questions: { type: "array", items: { type: "string" } },
    },
  },
} as const;

const forbidden = /\b(?:mpn|part\s*number|package\s*pad|pin\s*\d+|gpio[a-z]?\d+|pa\d+|pb\d+|pc\d+|\d+\s*(?:ohm|kohm|pf|nf|uf)|x\s*=|y\s*=)\b/i;

export function createInterfacePlanningProposal(input: Omit<InterfacePlanningProposal, "schemaVersion" | "deterministicDigest">): InterfacePlanningProposal {
  const base = { schemaVersion: "sirkit.interface-planning-proposal.v1" as const, ...structuredClone(input), choices: [...input.choices].sort((a, b) => a.architectureFlowId.localeCompare(b.architectureFlowId)) };
  return { ...base, deterministicDigest: interfaceDigest(base) };
}

export function validateInterfacePlanningProposal(proposal: InterfacePlanningProposal, problem: InterfacePlanningProblem): InterfaceDiagnostic[] {
  const diagnostics: InterfaceDiagnostic[] = [];
  const add = (code: string, message: string, refs: string[] = []) => diagnostics.push({ diagnosticId: `interface-diagnostic:${interfaceDigest({ code, message, refs }).slice(5)}`, code, severity: "blocking", message, objectRefs: refs.sort(), requirementRefs: [], blocks: "logical_planning", derivation: "Strict provider-neutral CD-4 proposal schema", nextAction: "Return a proposal containing only bounded protocol/topology/resource choices backed by the pinned problem.", staleDependencyKeys: refs.sort() });
  if (proposal.schemaVersion !== "sirkit.interface-planning-proposal.v1" || proposal.problemDigest !== problem.deterministicDigest || proposal.deterministicDigest !== interfaceDigest({ ...proposal, deterministicDigest: undefined })) add("INTERFACE_PROPOSAL_INTEGRITY_FAILED", "Proposal schema, problem binding, or digest is invalid.");
  if (proposal.choices.length !== problem.architectureFlowIds.length || new Set(proposal.choices.map((item) => item.architectureFlowId)).size !== proposal.choices.length) add("INTERFACE_PROPOSAL_FLOW_COVERAGE_INVALID", "Every pinned architecture flow must have exactly one choice.");
  for (const choice of proposal.choices) {
    if (!problem.architectureFlowIds.includes(choice.architectureFlowId)) add("INTERFACE_PROPOSAL_FLOW_UNKNOWN", "Proposal references a flow outside the pinned problem.", [choice.architectureFlowId]);
    const pattern = getProtocolPattern(choice.protocolClass); if (!pattern) add("INTERFACE_PROPOSAL_PROTOCOL_UNKNOWN", `Protocol class '${choice.protocolClass}' is not in the pinned registry.`, [choice.architectureFlowId]);
    else if (!pattern.supportedTopologies.includes(choice.topologyClass)) add("INTERFACE_PROPOSAL_TOPOLOGY_UNSUPPORTED", `Topology '${choice.topologyClass}' is not supported for '${choice.protocolClass}'.`, [choice.architectureFlowId]);
    if (!choice.rationale.trim()) add("INTERFACE_PROPOSAL_RATIONALE_REQUIRED", "Each choice requires a reviewable rationale.", [choice.architectureFlowId]);
  }
  if (forbidden.test([proposal.title, proposal.summary, ...proposal.choices.map((item) => item.rationale), ...proposal.assumptions, ...proposal.questions].join(" "))) add("INTERFACE_PROPOSAL_CONCRETE_IMPLEMENTATION_FORBIDDEN", "Proposal contains a concrete part, terminal, value, or coordinate outside CD-4 authority.");
  return diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.diagnosticId.localeCompare(b.diagnosticId));
}
