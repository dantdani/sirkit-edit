import { normalizeQuantity } from "../constraints/quantity";
import type { PowerConcurrencyConstraint, PowerQuantityRange } from "./types";
import { powerDigest, powerId } from "./stable";
import { sumPowerRanges } from "./quantity";

export interface PeakEvent { demandId: string; quantityRange: PowerQuantityRange; }
export interface ConcurrencySolution { state: "solved" | "incomplete_unknown" | "limit_exceeded" | "infeasible_constraints"; selectedDemandIds: string[]; peakRange: PowerQuantityRange | null; evaluatedSubsets: number; conservativeUnknown: boolean; deterministicDigest: string; }

function value(range: PowerQuantityRange): number { const n = normalizeQuantity(range.max); return n.sign * Number(n.digits) * 10 ** (-n.scale); }

function validSet(selected: Set<string>, constraints: readonly PowerConcurrencyConstraint[]): boolean {
  for (const constraint of constraints) {
    const count = constraint.demandIds.filter((id) => selected.has(id)).length;
    if (constraint.kind === "must_overlap" || constraint.kind === "correlated_by_event") { if (count !== 0 && count !== constraint.demandIds.length) return false; }
    else if (constraint.kind === "mutually_exclusive" || constraint.kind === "ordered_nonoverlap") { if (count > 1) return false; }
    else if (constraint.kind === "bounded_cardinality" && count > (constraint.cardinality ?? 0)) return false;
  }
  return true;
}

/** Branch-and-bound exact solver for the profile-bounded event set. */
export function solvePeakConcurrency(events: readonly PeakEvent[], constraints: readonly PowerConcurrencyConstraint[], options: { maximumEvents: number; unknownPolicy: "conservative_overlap" | "block" }): ConcurrencySolution {
  if (events.length > options.maximumEvents) return finish("limit_exceeded", [], null, 0, false);
  if (constraints.some((item) => item.kind === "unknown") && options.unknownPolicy === "block") return finish("incomplete_unknown", [], null, 0, false);
  const ordered = [...events].sort((a, b) => value(b.quantityRange) - value(a.quantityRange) || a.demandId.localeCompare(b.demandId)); let bestIds: string[] = []; let bestValue = -Infinity; let evaluated = 0;
  const suffix = ordered.map((_, index) => ordered.slice(index).reduce((sum, item) => sum + Math.max(0, value(item.quantityRange)), 0));
  function visit(index: number, selected: Set<string>, total: number): void {
    if (index === ordered.length) { evaluated++; if (validSet(selected, constraints) && (total > bestValue || total === bestValue && [...selected].sort().join("|") < bestIds.join("|"))) { bestValue = total; bestIds = [...selected].sort(); } return; }
    if (total + suffix[index] < bestValue) return;
    // A partially selected must-overlap/correlated group is not invalid yet: a
    // later branch can still select the remaining members.  Constraint
    // validity is therefore checked only for complete assignments.
    selected.add(ordered[index].demandId); visit(index + 1, selected, total + value(ordered[index].quantityRange)); selected.delete(ordered[index].demandId); visit(index + 1, selected, total);
  }
  visit(0, new Set(), 0); if (bestValue < 0) return finish("infeasible_constraints", [], null, evaluated, false);
  const peak = sumPowerRanges(events.filter((item) => bestIds.includes(item.demandId)).map((item) => item.quantityRange)); return finish("solved", bestIds, peak, evaluated, constraints.some((item) => item.kind === "unknown"));
}

/** Intentionally simple exhaustive oracle, kept separate from branch-and-bound pruning. */
export function exhaustivePeakConcurrencyOracle(events: readonly PeakEvent[], constraints: readonly PowerConcurrencyConstraint[], options: { maximumEvents: number; unknownPolicy: "conservative_overlap" | "block" }): ConcurrencySolution {
  if (events.length > options.maximumEvents) return finish("limit_exceeded", [], null, 0, false);
  if (constraints.some((item) => item.kind === "unknown") && options.unknownPolicy === "block") return finish("incomplete_unknown", [], null, 0, false);
  let bestIds: string[] = []; let best = -Infinity; let evaluated = 0;
  for (let mask = 0; mask < 2 ** events.length; mask++) { const ids = events.filter((_, index) => mask & 2 ** index).map((item) => item.demandId).sort(); const set = new Set(ids); if (!validSet(set, constraints)) continue; evaluated++; const total = events.filter((item) => set.has(item.demandId)).reduce((sum, item) => sum + value(item.quantityRange), 0); if (total > best || total === best && ids.join("|") < bestIds.join("|")) { best = total; bestIds = ids; } }
  if (best < 0) return finish("infeasible_constraints", [], null, evaluated, false); return finish("solved", bestIds, sumPowerRanges(events.filter((item) => bestIds.includes(item.demandId)).map((item) => item.quantityRange)), evaluated, constraints.some((item) => item.kind === "unknown"));
}

function finish(state: ConcurrencySolution["state"], selectedDemandIds: string[], peakRange: PowerQuantityRange | null, evaluatedSubsets: number, conservativeUnknown: boolean): ConcurrencySolution { const base = { state, selectedDemandIds, peakRange, evaluatedSubsets, conservativeUnknown }; return { ...base, deterministicDigest: powerDigest({ solver: "sirkit-power-concurrency/1.0.0", ...base }) }; }

export function assertConcurrencyOracleEquivalent(production: ConcurrencySolution, oracle: ConcurrencySolution): void {
  const shape = (value: ConcurrencySolution) => ({ state: value.state, ids: value.selectedDemandIds, peak: value.peakRange }); if (powerDigest(shape(production)) !== powerDigest(shape(oracle))) throw new Error(powerId("CONCURRENCY_ORACLE_DIVERGENCE", { production: shape(production), oracle: shape(oracle) }));
}
