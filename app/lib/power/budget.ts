import { compareQuantities } from "../constraints/quantity";
import { assertConcurrencyOracleEquivalent, exhaustivePeakConcurrencyOracle, solvePeakConcurrency, type PeakEvent } from "./concurrency";
import { powerId } from "./stable";
import { powerOverVoltageCurrent, subtractPowerRanges, sumPowerRanges, voltageCurrentPower } from "./quantity";
import type { LoadProfile, PowerArchitectureProblem, PowerBudget, PowerContribution, PowerRail, PowerQuantityRange, ThermalPowerBudget } from "./types";

function currentFor(profile: LoadProfile, rail: PowerRail): PowerQuantityRange | null {
  const point = profile.operatingPointRecords.find((item) => item.currentRange || item.powerRange); if (!point) return null;
  if (point.currentRange) return point.currentRange; if (point.powerRange && rail.operatingVoltageRange) return powerOverVoltageCurrent(point.powerRange, rail.operatingVoltageRange); return null;
}

export function calculatePowerBudgets(input: { problem: PowerArchitectureProblem; rails: readonly PowerRail[]; demandRailIds: ReadonlyMap<string, string>; directRailIds: ReadonlySet<string>; maximumSolverEvents: number }): PowerBudget[] {
  const profiles = new Map(input.problem.loadProfiles.map((item) => [item.loadProfileId, item])); const demands = new Map(input.problem.demands.map((item) => [item.demandId, item])); const sources = new Map(input.problem.sources.map((item) => [item.sourceId, item])); const output: PowerBudget[] = [];
  for (const scenario of input.problem.scenarios) for (const rail of input.rails) {
    const demandIds = scenario.activeDemandIds.filter((id) => input.demandRailIds.get(id) === rail.railId); if (!demandIds.length) continue;
    if (new Set(demandIds).size !== demandIds.length) throw new Error("POWER_BUDGET_DUPLICATE_DEMAND");
    const events: PeakEvent[] = []; const unknown: PowerContribution[] = [];
    for (const demandId of demandIds) { const demand = demands.get(demandId); const profile = demand ? profiles.get(demand.loadProfileId) : undefined; const range = profile ? currentFor(profile, rail) : null; if (range) events.push({ demandId, quantityRange: range }); else unknown.push({ contributionId: powerId("power-contribution", { scenario: scenario.scenarioId, rail: rail.railId, demandId, class: "unknown" }), demandOrLossId: demandId, classification: "unknown", quantityRange: null, inclusionReason: "Bounded maximum current or convertible power is missing.", conversionPathIds: rail.sourcePathIds, derivationNodeId: powerId("power-derivation", { demandId, scenario: scenario.scenarioId }) }); }
    const constraints = scenario.concurrencyConstraints.filter((item) => item.demandIds.some((id) => demandIds.includes(id))).map((item) => ({ ...item, demandIds: item.demandIds.filter((id) => demandIds.includes(id)) }));
    const solution = solvePeakConcurrency(events, constraints, { maximumEvents: input.maximumSolverEvents, unknownPolicy: scenario.unknownConcurrencyPolicy }); const oracle = exhaustivePeakConcurrencyOracle(events, constraints, { maximumEvents: input.maximumSolverEvents, unknownPolicy: scenario.unknownConcurrencyPolicy }); assertConcurrencyOracleEquivalent(solution, oracle);
    const contributions: PowerContribution[] = events.map((event) => ({ contributionId: powerId("power-contribution", { scenario: scenario.scenarioId, rail: rail.railId, demand: event.demandId }), demandOrLossId: event.demandId, classification: "load", quantityRange: event.quantityRange, inclusionReason: solution.selectedDemandIds.includes(event.demandId) ? "Included in exact peak-concurrency optimum." : "Excluded by concurrency constraints from the peak set.", conversionPathIds: rail.sourcePathIds, derivationNodeId: powerId("power-derivation", { demand: event.demandId, scenario: scenario.scenarioId }) }));
    const source = rail.sourcePathIds.map((id) => sources.get(id)).find(Boolean); const allocatedRange = rail.sourcePathIds.length === 1 && input.directRailIds.has(rail.railId) ? source?.continuousCurrentRange ?? null : null; const used = solution.peakRange;
    let feasibilityState: PowerBudget["feasibilityState"] = "pass_supported"; let remaining: PowerQuantityRange | null = null;
    if (solution.state === "limit_exceeded" || solution.state === "incomplete_unknown" || unknown.length || !used || !allocatedRange) feasibilityState = "incomplete_unknown_input";
    else {
      try {
        // A source current interval describes its permitted operating draw;
        // its upper endpoint is the hard capacity ceiling.  Headroom is the
        // ceiling minus the load interval, not interval subtraction against
        // the source's minimum operating draw (which is commonly zero).
        const capacityCeiling: PowerQuantityRange = { ...allocatedRange, min: allocatedRange.max, max: allocatedRange.max };
        remaining = subtractPowerRanges(capacityCeiling, used);
        if (compareQuantities(used.max, allocatedRange.max) > 0) feasibilityState = "fail_hard_limit";
      } catch { feasibilityState = "unsupported_model"; }
    }
    if (events.some((item) => item.quantityRange.basis === "typical") && feasibilityState === "pass_supported") feasibilityState = "incomplete_unknown_input";
    output.push({ budgetId: powerId("power-budget", { problem: input.problem.deterministicDigest, rail: rail.railId, scenario: scenario.scenarioId, kind: "current" }), railOrSourceId: rail.railId, scenarioId: scenario.scenarioId, quantityKind: "current", demandContributions: contributions, conversionLossContributions: [], reserveContributions: [], unknownContributions: unknown, allocatedRange, estimatedUsedRange: used, remainingRange: remaining, marginPolicyRef: null, confidence: feasibilityState === "pass_supported" ? "high" : "low", feasibilityState, derivationGraphId: powerId("power-budget-derivation", { rail: rail.railId, scenario: scenario.scenarioId, events: solution.selectedDemandIds }), limitingContributionIds: contributions.filter((item) => solution.selectedDemandIds.includes(item.demandOrLossId)).map((item) => item.contributionId), uncertaintyDrivers: [...(solution.conservativeUnknown ? ["unknown concurrency treated as conservative overlap"] : []), ...unknown.map((item) => item.demandOrLossId), ...(!allocatedRange ? ["rail output current capability not yet established"] : [])], verificationObligationIds: [powerId("budget-verification", { rail: rail.railId, scenario: scenario.scenarioId, stages: "CD-6/CD-7/CD-10" })] });
  }
  return output.sort((a, b) => a.budgetId.localeCompare(b.budgetId));
}

export function buildThermalBudgets(problem: PowerArchitectureProblem, rails: readonly PowerRail[], budgets: readonly PowerBudget[]): ThermalPowerBudget[] {
  return problem.scenarios.map((scenario) => {
    const powerRanges = budgets.filter((item) => item.scenarioId === scenario.scenarioId && item.quantityKind === "current" && item.estimatedUsedRange).flatMap((budget) => { const rail = rails.find((item) => item.railId === budget.railOrSourceId); return rail?.operatingVoltageRange && budget.estimatedUsedRange ? [voltageCurrentPower(rail.operatingVoltageRange, budget.estimatedUsedRange)] : []; }); const useful = sumPowerRanges(powerRanges);
    return { budgetId: powerId("thermal-budget", { problem: problem.deterministicDigest, scenario: scenario.scenarioId }), scenarioId: scenario.scenarioId, scope: "board", ambientEnvelope: null, enclosureAirflowAssumptions: [], usefulLoadPowerRange: useful, conversionLossRange: null, distributionProtectionLossRange: null, quiescentStandbyLossRange: null, totalBoardDissipationRange: null, localizedLossAllocations: rails.map((rail) => ({ roleId: rail.railId, lossRange: null })), temperatureRiseModelState: "not_evaluated" as const, uncertaintyModel: "Exact devices, loss models, packages, PCB copper, enclosure, airflow, and thermal paths are deferred.", feasibilityState: useful ? "incomplete_unknown_input" as const : "not_applicable" as const, downstreamThermalObligationIds: [powerId("thermal-obligation", { scenario: scenario.scenarioId, stage: "CD-6/CD-7/CD-10/PCB" })] };
  }).sort((a, b) => a.budgetId.localeCompare(b.budgetId));
}
