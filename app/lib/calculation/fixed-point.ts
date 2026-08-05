import { calculationDigest } from "./stable";

export interface FixedPointResult<T> { state: "stable" | "oscillation" | "resource_limit" | "blocked"; value: T; iterations: number; semanticDigestHistory: string[]; diagnostics: string[]; }

export function solveCd6Cd7FixedPoint<T>(input: { initial: T; maximumIterations: number; step: (value: T, iteration: number) => { value: T; blockedReason?: string }; semanticProjection?: (value: T) => unknown }): FixedPointResult<T> {
  if (!Number.isSafeInteger(input.maximumIterations) || input.maximumIterations < 1) throw new Error("CD7_FIXED_POINT_LIMIT_INVALID");
  const digest = (value: T) => calculationDigest(input.semanticProjection ? input.semanticProjection(value) : value);
  let current = structuredClone(input.initial); const history = [digest(current)];
  for (let iteration = 1; iteration <= input.maximumIterations; iteration++) {
    const next = input.step(structuredClone(current), iteration);
    if (next.blockedReason) return { state: "blocked", value: current, iterations: iteration, semanticDigestHistory: history, diagnostics: [next.blockedReason] };
    const nextDigest = digest(next.value);
    if (nextDigest === history.at(-1)) return { state: "stable", value: next.value, iterations: iteration, semanticDigestHistory: [...history, nextDigest], diagnostics: [] };
    if (history.includes(nextDigest)) return { state: "oscillation", value: next.value, iterations: iteration, semanticDigestHistory: [...history, nextDigest], diagnostics: ["CD7_CD6_REBINDING_OSCILLATION"] };
    current = structuredClone(next.value); history.push(nextDigest);
  }
  return { state: "resource_limit", value: current, iterations: input.maximumIterations, semanticDigestHistory: history, diagnostics: ["CD7_CD6_REBINDING_ITERATION_LIMIT"] };
}
