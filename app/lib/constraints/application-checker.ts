import type {
  ConstraintProgram,
  ConstraintQuantity,
  ConstraintViolation,
  EffectiveConstraintRule,
  TypedRequirement,
} from "./types";
import { compareQuantities } from "./quantity";
import { stableConstraintId } from "./stable";

export interface ApplicationTerminalState {
  id: string;
  componentId: string;
  classification: "electrical" | "nc" | "dnc" | "nu" | "mechanical" | "exposed_thermal" | "unknown";
  connected: boolean | "unknown";
  netStableId?: string;
}

export interface ApplicationDecouplingState {
  id: string;
  protectedTargetId: string;
  railId?: string;
  returnNetId?: string;
  capacitance?: ConstraintQuantity;
  voltageRating?: ConstraintQuantity;
}

export interface ApplicationCheckSnapshot {
  designRevision: string;
  voltagesByTarget: Record<string, ConstraintQuantity | undefined>;
  railLoadsByTarget: Record<string, { totalLoad?: ConstraintQuantity; sourceCapacity?: ConstraintQuantity; unknownLoads: number }>;
  terminals: ApplicationTerminalState[];
  decoupling: ApplicationDecouplingState[];
  decouplingDataComplete: boolean;
  satisfiedRelationshipIds: string[];
}

function passesQuantity(actual: ConstraintQuantity, requirement: TypedRequirement): boolean | null {
  try {
    if (requirement.form === "minimum") return compareQuantities(actual, requirement.value) >= 0;
    if (requirement.form === "maximum") return compareQuantities(actual, requirement.value) <= 0;
    if (requirement.form === "range") {
      const lower = compareQuantities(actual, requirement.min);
      const upper = compareQuantities(actual, requirement.max);
      return (lower > 0 || lower === 0 && requirement.minInclusive) && (upper < 0 || upper === 0 && requirement.maxInclusive);
    }
    if (requirement.form === "equals" && typeof requirement.value === "object" && "dimension" in requirement.value) return compareQuantities(actual, requirement.value) === 0;
  } catch {
    return null;
  }
  return null;
}

function result(rule: EffectiveConstraintRule, state: ConstraintViolation["state"], message: string, actual?: ConstraintViolation["actual"]): ConstraintViolation {
  return {
    id: stableConstraintId("constraint-result", { ruleId: rule.id, state, message, actual }),
    constraintId: rule.contributingConstraintIds[0],
    targetIds: [rule.targetId],
    state,
    consumerId: "application-erc",
    checkerVersion: "stage6-application/1",
    ...(actual !== undefined ? { actual } : {}),
    required: rule.requirement,
    evidenceIds: [...rule.evidenceIds],
    message,
    nextAction: state === "pass" ? "No action required." : "Correct the exact connection/component fact or provide the missing source-backed input.",
  };
}

export function runApplicationChecks(program: ConstraintProgram, snapshot: ApplicationCheckSnapshot): ConstraintViolation[] {
  if (snapshot.designRevision !== program.designRevision) {
    return program.lowerings.schematicRules.map((rule) => result(rule, "stale", "Application snapshot does not match the compiled program revision."));
  }
  const output: ConstraintViolation[] = [];
  for (const rule of program.lowerings.schematicRules) {
    if (rule.kind === "voltage_operating_range" || rule.kind === "voltage_absolute_maximum") {
      const actual = snapshot.voltagesByTarget[rule.targetId];
      if (!actual) output.push(result(rule, "unknown", `Voltage for ${rule.targetId} is unknown; absolute maximum was not substituted for recommended operation.`));
      else {
        const passes = passesQuantity(actual, rule.requirement);
        output.push(result(rule, passes === null ? "unknown" : passes ? "pass" : "fail", `${rule.kind === "voltage_absolute_maximum" ? "Damage-limit" : "Recommended operating"} voltage check ${passes ? "passed" : passes === false ? "failed" : "could not be evaluated"}.`, actual));
      }
    } else if (rule.kind === "dnc_connection" || rule.kind === "exposed_pad_connection") {
      const classification = rule.kind === "dnc_connection" ? "dnc" : "exposed_thermal";
      const terminals = snapshot.terminals.filter((terminal) => terminal.componentId === rule.targetId && terminal.classification === classification);
      if (terminals.length === 0 || terminals.some((terminal) => terminal.connected === "unknown")) output.push(result(rule, "unknown", `Exact ${classification} terminal connectivity is unavailable.`));
      else {
        const fail = rule.kind === "dnc_connection" ? terminals.some((terminal) => terminal.connected === true) : terminals.some((terminal) => terminal.connected === false);
        output.push(result(rule, fail ? "fail" : "pass", fail ? `${classification} terminal connection requirement failed.` : `${classification} terminal connection requirement passed.`));
      }
    } else if (rule.kind === "current_budget") {
      const rail = snapshot.railLoadsByTarget[rule.targetId];
      if (!rail || rail.unknownLoads > 0 || !rail.totalLoad || !rail.sourceCapacity) output.push(result(rule, "unknown", "Current budget has unknown load or source-capacity inputs."));
      else {
        const withinSource = compareQuantities(rail.totalLoad, rail.sourceCapacity) <= 0;
        const withinRequirement = rule.requirement.form === "budget" && "dimension" in rule.requirement.limit ? passesQuantity(rail.totalLoad, { form: "maximum", value: rule.requirement.limit }) : null;
        const pass = withinSource && withinRequirement !== false;
        output.push(result(rule, withinRequirement === null ? "unknown" : pass ? "pass" : "fail", pass ? "Aggregate current budget passed." : "Aggregate current budget exceeds a sourced limit.", rail.totalLoad));
      }
    } else if (rule.kind === "decoupling") {
      const matches = snapshot.decoupling.filter((item) => item.protectedTargetId === rule.targetId);
      if (!snapshot.decouplingDataComplete) output.push(result(rule, "unknown", "Decoupling relationship data is incomplete; an arbitrary capacitor was not accepted."));
      else {
        const required = rule.requirement.form === "must_exist" && rule.requirement.cardinality.kind === "at_least" ? rule.requirement.cardinality.count : 1;
        output.push(result(rule, matches.length >= required ? "pass" : "fail", matches.length >= required ? "Exact decoupling relationship cardinality passed." : `Expected at least ${required} exact decoupling relationship(s), found ${matches.length}.`));
      }
    } else if (rule.requirement.form === "must_connect" || rule.requirement.form === "must_not_connect") {
      const present = snapshot.satisfiedRelationshipIds.includes(rule.requirement.relationshipId);
      const pass = rule.requirement.form === "must_connect" ? present : !present;
      output.push(result(rule, pass ? "pass" : "fail", `Relationship ${rule.requirement.relationshipId} ${pass ? "satisfied" : "violated"} the connection requirement.`));
    } else output.push(result(rule, "unsupported", `No deterministic application checker exists for ${rule.kind}/${rule.requirement.form}.`));
  }
  return output.sort((a, b) => a.id.localeCompare(b.id));
}

