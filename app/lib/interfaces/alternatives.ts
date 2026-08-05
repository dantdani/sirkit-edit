import type { SystemArchitectureCandidate } from "../architecture/types";
import { createInterfacePlanningProposal, type InterfacePlanningProposal } from "./proposal-schema";
import { interfaceId } from "./stable";
import type { InterfacePlanningProblem } from "./types";

function protocolForFlow(kind: SystemArchitectureCandidate["flows"][number]["flowKind"]): string {
  if (kind === "analog") return "analog_channel"; if (kind === "clock") return "clock_distribution"; if (kind === "reset") return "reset_distribution"; if (kind === "debug") return "debug_access"; if (kind === "control") return "discrete_control"; return "custom_typed_transport";
}
function topologyForFlow(flow: SystemArchitectureCandidate["flows"][number]): InterfacePlanningProposal["choices"][number]["topologyClass"] { return flow.consumerPortIds.length > 1 ? (flow.flowKind === "clock" || flow.flowKind === "reset" ? "broadcast" : "multidrop") : "point_to_point"; }

export function synthesizeInterfacePlanningProposals(problem: InterfacePlanningProblem, architecture: SystemArchitectureCandidate, count = 3): InterfacePlanningProposal[] {
  if (architecture.deterministicDigest !== problem.systemArchitectureCandidateRevision.candidateDigest) throw new Error("INTERFACE_ALTERNATIVE_ARCHITECTURE_MISMATCH");
  const partitions: InterfacePlanningProposal["choices"][number]["resourcePartition"][] = ["direct_resource", "shared_controller", "separate_controllers"];
  return partitions.slice(0, Math.max(1, Math.min(count, partitions.length))).map((partition, index) => createInterfacePlanningProposal({
    proposalId: interfaceId("interface-proposal", { problem: problem.deterministicDigest, partition, index }), problemDigest: problem.deterministicDigest,
    title: partition === "direct_resource" ? "Direct typed resources" : partition === "shared_controller" ? "Shared controller resources" : "Separated controller resources",
    summary: "A bounded logical protocol/topology/resource partition alternative. Exact parts, pins, values, nets, firmware, and geometry remain outside this proposal.",
    choices: architecture.flows.map((flow) => ({ architectureFlowId: flow.flowId, protocolClass: protocolForFlow(flow.flowKind), topologyClass: topologyForFlow(flow), resourcePartition: partition, rationale: `${flow.flowKind} semantics and explicit endpoint cardinality determine this planning-level choice; exact capability remains deferred.` })), assumptions: [], questions: problem.blockingUnknownIds,
  }));
}

