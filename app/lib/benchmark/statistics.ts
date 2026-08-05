import type { MetricDirection } from "./types";

export function quantile(values: readonly number[], q: number): number | null {
  if (!values.length || q < 0 || q > 1) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q; const lower = Math.floor(index); const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function ranks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const result = Array(values.length).fill(0);
  for (let start = 0; start < indexed.length;) {
    let end = start + 1; while (end < indexed.length && indexed[end].value === indexed[start].value) end += 1;
    const rank = (start + end - 1) / 2 + 1;
    for (let index = start; index < end; index += 1) result[indexed[index].index] = rank;
    start = end;
  }
  return result;
}

export function spearmanRankCorrelation(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const a = ranks(left); const b = ranks(right);
  const ma = a.reduce((sum, value) => sum + value, 0) / a.length; const mb = b.reduce((sum, value) => sum + value, 0) / b.length;
  let numerator = 0; let da = 0; let db = 0;
  for (let index = 0; index < a.length; index += 1) { const x = a[index] - ma; const y = b[index] - mb; numerator += x * y; da += x * x; db += y * y; }
  return da === 0 || db === 0 ? null : numerator / Math.sqrt(da * db);
}

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value += 0x6d2b79f5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export interface PairedSummary {
  pairs: number;
  deltas: number[];
  medianDelta: number | null;
  meanDelta: number | null;
  confidenceInterval95: [number, number] | null;
  wins: number;
  ties: number;
  losses: number;
  timeoutPairsRetained: number;
}

export function pairedBootstrap(input: { baseline: readonly number[]; candidate: readonly number[]; lowerIsBetter: boolean; iterations?: number; seed?: number; practicalTie?: number; timeoutPairsRetained?: number }): PairedSummary {
  if (input.baseline.length !== input.candidate.length) throw new Error("PAIRED_LENGTH_MISMATCH");
  const deltas = input.candidate.map((value, index) => value - input.baseline[index]);
  const practicalTie = input.practicalTie ?? 0;
  const samples: number[] = []; const random = rng(input.seed ?? 9); const iterations = input.iterations ?? 2_000;
  if (deltas.length) for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0; for (let index = 0; index < deltas.length; index += 1) sum += deltas[Math.floor(random() * deltas.length)];
    samples.push(sum / deltas.length);
  }
  const wins = deltas.filter((delta) => Math.abs(delta) > practicalTie && (input.lowerIsBetter ? delta < 0 : delta > 0)).length;
  const losses = deltas.filter((delta) => Math.abs(delta) > practicalTie && (input.lowerIsBetter ? delta > 0 : delta < 0)).length;
  return { pairs: deltas.length, deltas, medianDelta: quantile(deltas, 0.5), meanDelta: deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null, confidenceInterval95: samples.length ? [quantile(samples, 0.025)!, quantile(samples, 0.975)!] : null, wins, ties: deltas.length - wins - losses, losses, timeoutPairsRetained: input.timeoutPairsRetained ?? 0 };
}

export function benjaminiHochberg(pValues: readonly number[], alpha = 0.05): boolean[] {
  const indexed = pValues.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  let cutoff = -1;
  indexed.forEach((item, rank) => { if (item.value <= alpha * (rank + 1) / indexed.length) cutoff = rank; });
  const result = Array(pValues.length).fill(false);
  for (let index = 0; index <= cutoff; index += 1) result[indexed[index].index] = true;
  return result;
}

export interface ParetoPoint { id: string; values: Record<string, number>; feasible: boolean }
export function paretoFront(points: readonly ParetoPoint[], dimensions: ReadonlyArray<{ metricId: string; direction: Extract<MetricDirection, "higher_is_better" | "lower_is_better"> }>): ParetoPoint[] {
  const feasible = points.filter((point) => point.feasible);
  return feasible.filter((candidate) => !feasible.some((other) => {
    if (other.id === candidate.id) return false;
    const noWorse = dimensions.every((dimension) => dimension.direction === "lower_is_better" ? other.values[dimension.metricId] <= candidate.values[dimension.metricId] : other.values[dimension.metricId] >= candidate.values[dimension.metricId]);
    const better = dimensions.some((dimension) => dimension.direction === "lower_is_better" ? other.values[dimension.metricId] < candidate.values[dimension.metricId] : other.values[dimension.metricId] > candidate.values[dimension.metricId]);
    return noWorse && better;
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export function failureRate(states: readonly string[], successStates: readonly string[]): { total: number; successes: number; failures: number; rate: number | null; denominators: Record<string, number> } {
  const success = new Set(successStates); const denominators: Record<string, number> = {};
  for (const state of states) denominators[state] = (denominators[state] ?? 0) + 1;
  const successes = states.filter((state) => success.has(state)).length;
  return { total: states.length, successes, failures: states.length - successes, rate: states.length ? (states.length - successes) / states.length : null, denominators };
}
