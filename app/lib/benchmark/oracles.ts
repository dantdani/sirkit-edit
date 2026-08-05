import type { OracleResult, OracleSpec } from "./types";

function numberClose(measured: number, expected: number, spec: OracleSpec): boolean {
  if (spec.tolerancePolicy.kind === "exact") return measured === expected;
  const tolerance = spec.tolerancePolicy.value ?? 0;
  if (spec.tolerancePolicy.kind === "absolute") return Math.abs(measured - expected) <= tolerance;
  if (spec.tolerancePolicy.kind === "relative") return Math.abs(measured - expected) <= Math.max(Math.abs(expected), 1) * tolerance;
  return measured === expected;
}

/** Generic analytical oracle. It deliberately imports no production PCB implementation. */
export function evaluateAnalyticalOracle(spec: OracleSpec, measured: Record<string, unknown>): OracleResult {
  if (spec.oracleKind !== "analytical" && spec.oracleKind !== "exact_golden") return { oracleId: spec.oracleId, state: "unsupported", explanation: "This evaluator only handles analytical/exact expected values.", evidenceRefs: [] };
  const expected = spec.analyticalExpectedValues ?? {}; const failures: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    const actual = measured[key];
    const passed = typeof value === "number" && typeof actual === "number" ? numberClose(actual, value, spec) : actual === value;
    if (!passed) failures.push(`${key}: expected ${String(value)}, measured ${String(actual)}`);
  }
  return { oracleId: spec.oracleId, state: failures.length ? "failed" : "passed", measured, expected, explanation: failures.length ? failures.join("; ") : "All analytical expectations matched.", evidenceRefs: [`oracle:${spec.oracleId}:v${spec.version}`] };
}

export type PropertyPredicate = (value: unknown) => { passed: boolean; explanation: string };
export function evaluatePropertyOracle(spec: OracleSpec, value: unknown, predicates: Readonly<Record<string, PropertyPredicate>>): OracleResult {
  if (spec.oracleKind !== "property" && spec.oracleKind !== "metamorphic" && spec.oracleKind !== "independent_checker") return { oracleId: spec.oracleId, state: "unsupported", explanation: "Oracle kind is not a property/checker oracle.", evidenceRefs: [] };
  const results = spec.propertyPredicates.map((name) => ({ name, result: predicates[name]?.(value) }));
  const missing = results.filter((item) => !item.result).map((item) => item.name);
  if (missing.length) return { oracleId: spec.oracleId, state: "unknown", explanation: `Predicate implementations missing: ${missing.join(", ")}.`, evidenceRefs: [] };
  const failures = results.filter((item) => item.result && !item.result.passed);
  return { oracleId: spec.oracleId, state: failures.length ? "failed" : "passed", measured: value, explanation: failures.length ? failures.map((item) => `${item.name}: ${item.result?.explanation}`).join("; ") : "All independent properties passed.", evidenceRefs: [`oracle:${spec.oracleId}:v${spec.version}`] };
}

export function resolveOracleConsensus(results: readonly OracleResult[]): { state: "passed" | "failed" | "unknown" | "oracle_disagreement"; explanation: string } {
  const decisive = results.filter((result) => result.state === "passed" || result.state === "failed");
  if (decisive.some((result) => result.state === "passed") && decisive.some((result) => result.state === "failed")) return { state: "oracle_disagreement", explanation: "Independent oracles disagree; claims and promotion are blocked while all evidence is retained." };
  if (decisive.some((result) => result.state === "failed")) return { state: "failed", explanation: "At least one decisive oracle failed and none passed in conflict." };
  if (decisive.length && decisive.every((result) => result.state === "passed")) return { state: "passed", explanation: "All decisive oracles passed." };
  return { state: "unknown", explanation: "No decisive oracle result is available." };
}
