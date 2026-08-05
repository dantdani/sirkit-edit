import { powerDigest, powerId } from "./stable";
import type { PowerRail, PowerSequenceMachine, PowerSequenceState, PowerSequenceTransition } from "./types";

export function buildPowerSequenceMachine(problemDigest: string, rails: readonly PowerRail[], owner: "hardware" | "firmware" | "mixed", scenarioRequirementIds: readonly string[] = []): PowerSequenceMachine {
  const sid = (role: string) => powerId("power-sequence-state", { problemDigest, role });
  const states: PowerSequenceState[] = [
    { stateId: sid("no-source"), label: "No source", safe: true, terminal: false, railValidity: Object.fromEntries(rails.map((rail) => [rail.railId, "invalid"])) },
    { stateId: sid("source-valid"), label: "Source valid, rails disabled", safe: true, terminal: false, railValidity: Object.fromEntries(rails.map((rail) => [rail.railId, "invalid"])) },
    { stateId: sid("rails-starting"), label: "Rails starting; reset asserted", safe: false, terminal: false, railValidity: Object.fromEntries(rails.map((rail) => [rail.railId, "starting"])) },
    { stateId: sid("operating"), label: "Rails valid; operation allowed", safe: false, terminal: false, railValidity: Object.fromEntries(rails.map((rail) => [rail.railId, "valid"])) },
    { stateId: sid("brownout"), label: "Brownout; reset asserted and loads shed", safe: true, terminal: false, railValidity: Object.fromEntries(rails.map((rail) => [rail.railId, "unknown"])) },
    { stateId: sid("shutdown"), label: "Controlled shutdown", safe: true, terminal: false, railValidity: Object.fromEntries(rails.map((rail) => [rail.railId, "invalid"])) },
    { stateId: sid("discharged"), label: "Discharged safe state", safe: true, terminal: true, railValidity: Object.fromEntries(rails.map((rail) => [rail.railId, "invalid"])) },
    { stateId: sid("fault-latched"), label: "Fault latched safe", safe: true, terminal: true, railValidity: Object.fromEntries(rails.map((rail) => [rail.railId, "invalid"])) },
  ];
  const tid = (from: string, to: string, trigger: string) => powerId("power-sequence-transition", { problemDigest, from, to, trigger });
  const ownerKind = owner === "firmware" ? "firmware" as const : "dedicated_hardware" as const;
  const transition = (from: string, to: string, trigger: string, actions: string[], transitionOwner = ownerKind): PowerSequenceTransition => ({ transitionId: tid(from, to, trigger), fromStateId: sid(from), toStateId: sid(to), triggerEvent: trigger, guardConditions: [], actions, ownerKind: transitionOwner, ownerRoleId: owner === "firmware" ? "firmware-power-policy" : "power-supervision-role", failureStateId: sid("fault-latched"), requirementIds: [], assumptionIds: [], verificationObligationIds: [powerId("sequence-verification", { problemDigest, from, to, trigger, stage: "CD-7/CD-10" })] });
  const transitions = [
    transition("no-source", "source-valid", "source_valid", ["qualify_input"]),
    transition("source-valid", "rails-starting", "enable_requested", ["assert_reset", "enable_rails"]),
    transition("rails-starting", "operating", "all_required_rails_valid", ["request_reset_release"]),
    transition("operating", "brownout", "brownout_detected", ["assert_reset", "shed_nonessential_loads"], "dedicated_hardware"),
    transition("brownout", "rails-starting", "source_requalified", ["retry_with_bounded_policy"]),
    transition("operating", "shutdown", "shutdown_requested", ["request_state_flush", "disable_loads"]),
    transition("shutdown", "discharged", "rails_invalid_and_discharge_complete", ["enter_safe_terminal"]),
    transition("source-valid", "no-source", "source_removed", ["remain_reset"]),
    transition("rails-starting", "fault-latched", "startup_timeout", ["disable_rails", "latch_fault"]),
    transition("operating", "fault-latched", "protection_fault", ["assert_reset", "disable_rails", "latch_fault"], "dedicated_hardware"),
  ];
  const railDependencyEdges = rails.filter((rail) => !rail.alwaysOn).map((rail) => ({ fromRailId: rails.find((item) => item.alwaysOn)?.railId ?? rail.railId, toRailId: rail.railId, relation: "valid_before_enable" as const })).filter((item) => item.fromRailId !== item.toRailId);
  const base = { machineId: powerId("power-sequence", { problemDigest, rails: rails.map((item) => item.railId), owner }), scope: "product-power", initialStateId: sid("no-source"), states, transitions, railDependencyEdges, resetDependencyObligationIds: rails.map((rail) => powerId("cd4-reset-rail-validity", { rail: rail.railId })), timeoutPolicies: ["startup timeout required; exact range deferred to CD-7"], retryPolicies: ["bounded retry policy required; exact count/timing deferred"], faultLatchPolicies: ["hard protection fault latches until authorized recovery"], safeShutdownStateId: sid("discharged"), requirementIds: [...new Set([...rails.flatMap((item) => item.requirementIds), ...scenarioRequirementIds])].sort(), cd4HandoffIds: rails.map((rail) => powerId("cd4-power-sequence-handoff", { rail: rail.railId })) };
  return { ...base, deterministicValidationDigest: powerDigest({ states, transitions, railDependencyEdges }) };
}

export function validatePowerSequenceMachine(machine: PowerSequenceMachine): string[] {
  const errors: string[] = []; const states = new Set(machine.states.map((item) => item.stateId));
  if (!states.has(machine.initialStateId) || !states.has(machine.safeShutdownStateId)) errors.push("POWER_SEQUENCE_INITIAL_OR_SAFE_STATE_MISSING");
  if (new Set(machine.states.map((item) => item.stateId)).size !== machine.states.length || new Set(machine.transitions.map((item) => item.transitionId)).size !== machine.transitions.length) errors.push("POWER_SEQUENCE_ID_REUSE");
  for (const edge of machine.transitions) if (!states.has(edge.fromStateId) || !states.has(edge.toStateId) || edge.fromStateId === edge.toStateId) errors.push("POWER_SEQUENCE_TRANSITION_INVALID");
  const reached = new Set([machine.initialStateId]); let changed = true; while (changed) { changed = false; for (const edge of machine.transitions) if (reached.has(edge.fromStateId) && !reached.has(edge.toStateId)) { reached.add(edge.toStateId); changed = true; } }
  if (machine.states.some((item) => !reached.has(item.stateId))) errors.push("POWER_SEQUENCE_STATE_UNREACHABLE");
  const adjacency = new Map<string, string[]>(); for (const edge of machine.railDependencyEdges) adjacency.set(edge.fromRailId, [...(adjacency.get(edge.fromRailId) ?? []), edge.toRailId]); const visiting = new Set<string>(); const visited = new Set<string>();
  function visit(node: string): boolean { if (visiting.has(node)) return true; if (visited.has(node)) return false; visiting.add(node); if ((adjacency.get(node) ?? []).some(visit)) return true; visiting.delete(node); visited.add(node); return false; }
  if ([...adjacency.keys()].some(visit)) errors.push("POWER_SEQUENCE_RAIL_DEPENDENCY_CYCLE");
  const operating = machine.states.find((item) => item.label.includes("operation allowed")); if (operating && Object.values(operating.railValidity).some((value) => value !== "valid")) errors.push("POWER_SEQUENCE_RESET_RELEASE_WITH_INVALID_RAIL");
  return [...new Set(errors)].sort();
}
