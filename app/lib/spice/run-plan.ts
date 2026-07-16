import { createId, stableHash } from "./identity";
import type {
  Corner,
  DesignVariable,
  Distribution,
  RunPlan,
  RunPlanEstimate,
  RunPoint,
  SimulationProject,
  SimulationTest,
  Sweep,
} from "./types";
import { formatEngineering, parseEngineeringValue } from "./units";

interface AxisPoint {
  label: string;
  values: Record<string, string>;
  cornerId?: string;
  temperatureC?: number;
  monteCarloSample?: number;
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u1 = Math.max(1e-12, random());
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sweepValues(sweep: Sweep): string[] {
  const definition = sweep.definition;
  if (definition.kind === "list" || definition.kind === "expression") return [...definition.values];
  const start = parseEngineeringValue(definition.start)?.value;
  const stop = parseEngineeringValue(definition.stop)?.value;
  if (start === undefined || stop === undefined) throw new Error(`Sweep ${sweep.name} has invalid bounds`);
  if (definition.kind === "linear") {
    const step = parseEngineeringValue(definition.step)?.value;
    if (!step || Math.sign(stop - start) !== Math.sign(step)) throw new Error(`Sweep ${sweep.name} has an invalid step`);
    const values: string[] = [];
    const maxPoints = 100_000;
    for (let value = start, index = 0; index < maxPoints && (step > 0 ? value <= stop * (1 + 1e-12) : value >= stop * (1 - 1e-12)); value += step, index++) {
      values.push(String(value));
    }
    return values;
  }
  if (start <= 0 || stop <= 0 || stop < start) throw new Error(`Log sweep ${sweep.name} requires positive ascending bounds`);
  const decades = Math.log10(stop / start);
  const count = Math.max(1, Math.ceil(decades * definition.pointsPerDecade));
  return Array.from({ length: count + 1 }, (_, index) => String(start * 10 ** (index / definition.pointsPerDecade)));
}

function cartesian<T>(groups: T[][]): T[][] {
  if (groups.length === 0) return [[]];
  return groups.reduce<T[][]>((acc, group) => acc.flatMap((prefix) => group.map((item) => [...prefix, item])), [[]]);
}

function sweepAxis(test: SimulationTest, enabled: boolean): AxisPoint[] {
  if (!enabled) return [{ label: "nominal", values: {} }];
  const sweeps = test.sweeps.filter((sweep) => sweep.enabled);
  if (sweeps.length === 0) return [{ label: "nominal", values: {} }];
  const groups = sweeps.map((sweep) => sweepValues(sweep).map((value) => ({ sweep, value })));
  return cartesian(groups).map((combination) => ({
    label: combination.map(({ sweep, value }) => `${sweep.variable}=${value}`).join(", "),
    values: Object.fromEntries(combination.map(({ sweep, value }) => [sweep.variable, value])),
  }));
}

function excludedCorner(corner: Corner, exclusions: Array<Record<string, string>>): boolean {
  return exclusions.some((exclusion) => Object.entries(exclusion).every(([key, value]) => corner.variableValues[key] === value));
}

function cornerAxis(test: SimulationTest, enabled: boolean): AxisPoint[] {
  if (!enabled) return [{ label: "nominal", values: {} }];
  const sets = test.cornerSets.filter((set) => set.enabled);
  if (sets.length === 0) return [{ label: "nominal", values: {} }];
  const groups = sets.map((set) => set.corners.filter((corner) => corner.enabled && !excludedCorner(corner, set.exclusions ?? [])));
  return cartesian(groups).map((corners) => ({
    label: corners.map((corner) => corner.name).join(" × "),
    cornerId: corners.map((corner) => corner.id).join("+"),
    values: Object.assign({}, ...corners.map((corner) => corner.variableValues)),
    temperatureC: [...corners].reverse().find((corner) => corner.temperatureC !== undefined)?.temperatureC,
  }));
}

function sampledValue(variable: DesignVariable, distribution: Distribution, random: () => number, correlated: number | undefined): string {
  const parsed = parseEngineeringValue(variable.value);
  if (!parsed) return variable.value;
  const unit = parsed.unit;
  const base = parsed.value;
  let sampled = base;
  if (distribution.kind === "uniform") {
    const u = correlated ?? random();
    sampled = base * (1 + (u * 2 - 1) * distribution.tolerance);
  } else if (distribution.kind === "gaussian") {
    let z = correlated === undefined ? gaussian(random) : inverseNormalApprox(correlated);
    if (distribution.truncationSigma) z = Math.max(-distribution.truncationSigma, Math.min(distribution.truncationSigma, z));
    sampled = base * (1 + z * distribution.sigma);
  } else if (distribution.kind === "lognormal") {
    let z = correlated === undefined ? gaussian(random) : inverseNormalApprox(correlated);
    if (distribution.truncationSigma) z = Math.max(-distribution.truncationSigma, Math.min(distribution.truncationSigma, z));
    sampled = base * Math.exp(z * distribution.sigma);
  } else if (distribution.kind === "discrete") {
    const total = distribution.values.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
    let choice = (correlated ?? random()) * Math.max(total, Number.EPSILON);
    for (const entry of distribution.values) {
      choice -= Math.max(0, entry.weight);
      if (choice <= 0) return entry.value;
    }
    return distribution.values.at(-1)?.value ?? variable.value;
  } else if (distribution.kind === "custom") {
    const index = Math.min(distribution.samples.length - 1, Math.floor((correlated ?? random()) * distribution.samples.length));
    return distribution.samples[index] ?? variable.value;
  }
  return formatEngineering(sampled, unit, 8);
}

function inverseNormalApprox(p: number): number {
  // Peter J. Acklam's rational approximation, sufficient for deterministic
  // tolerance orchestration (the simulator—not this sampler—solves the circuit).
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  if (q > 1 - 0.02425) return -inverseNormalApprox(1 - q);
  const r = q - 0.5;
  const s = r * r;
  return (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

function monteCarloAxis(test: SimulationTest, enabled: boolean): AxisPoint[] {
  const config = test.monteCarlo;
  if (!enabled || !config?.enabled) return [{ label: "nominal", values: {} }];
  const variables = test.variables.filter((variable) => variable.enabled && variable.distribution);
  if (variables.length === 0) return [{ label: "nominal", values: {} }];
  const count = Math.max(1, Math.min(100_000, Math.round(config.samples)));
  const points: AxisPoint[] = [];
  if (config.includeNominal) points.push({ label: "MC nominal", values: {}, monteCarloSample: 0, seed: config.seed });
  const strata = Array.from({ length: count }, (_, index) => (index + 0.5) / count);
  for (let sample = 1; sample <= count; sample++) {
    const seed = (config.seed + Math.imul(sample, 0x9e3779b1)) >>> 0;
    const random = mulberry32(seed);
    const correlationValues = new Map<string, number>();
    const values: Record<string, string> = {};
    for (let variableIndex = 0; variableIndex < variables.length; variableIndex++) {
      const variable = variables[variableIndex];
      const distribution = variable.distribution!;
      const group = "correlationGroup" in distribution ? distribution.correlationGroup : undefined;
      let correlated: number | undefined;
      if (group) {
        correlated = correlationValues.get(group);
        if (correlated === undefined) {
          correlated = config.method === "latin-hypercube" ? strata[(sample - 1 + variableIndex * 7919) % count] : random();
          correlationValues.set(group, correlated);
        }
      } else if (config.method === "latin-hypercube") {
        correlated = strata[(sample - 1 + variableIndex * 7919) % count];
      }
      values[variable.name] = sampledValue(variable, distribution, random, correlated);
    }
    points.push({ label: `MC #${sample}`, values, monteCarloSample: sample, seed });
  }
  return points;
}

function mergeAxes(groups: AxisPoint[][]): AxisPoint[] {
  return cartesian(groups).map((entries) => ({
    label: entries.map((entry) => entry.label).filter((label) => label !== "nominal").join(" · ") || "nominal",
    values: Object.assign({}, ...entries.map((entry) => entry.values)),
    cornerId: entries.find((entry) => entry.cornerId)?.cornerId,
    temperatureC: [...entries].reverse().find((entry) => entry.temperatureC !== undefined)?.temperatureC,
    monteCarloSample: entries.find((entry) => entry.monteCarloSample !== undefined)?.monteCarloSample,
    seed: entries.find((entry) => entry.seed !== undefined)?.seed,
  }));
}

function enabledTests(project: SimulationProject, plan: RunPlan): SimulationTest[] {
  const ids = new Set(plan.testIds);
  return project.tests.filter((test) => test.enabled && ids.has(test.id));
}

export function estimateRunPlan(project: SimulationProject, runPlanId: string): RunPlanEstimate {
  const plan = project.runPlans.find((candidate) => candidate.id === runPlanId);
  if (!plan) throw new Error(`Run plan ${runPlanId} was not found`);
  const tests = enabledTests(project, plan);
  const runPoints: RunPoint[] = [];
  const warnings: string[] = [];
  let index = 0;
  for (const test of tests) {
    const analyses = test.analyses.filter((analysis) => analysis.enabled);
    if (analyses.length === 0) warnings.push(`${test.name} has no enabled analyses.`);
    const axes = mergeAxes([
      sweepAxis(test, plan.includeSweeps),
      cornerAxis(test, plan.includeCorners),
      monteCarloAxis(test, plan.includeMonteCarlo),
    ]);
    for (const analysis of analyses) {
      for (const axis of axes) {
        const variableValues = {
          ...Object.fromEntries(test.variables.filter((variable) => variable.enabled).map((variable) => [variable.name, variable.value])),
          ...axis.values,
        };
        const signature = { test: test.id, analysis: analysis.id, axis, variableValues, index };
        runPoints.push({
          id: `runpoint_${stableHash(signature)}`,
          index: index++,
          testId: test.id,
          analysisId: analysis.id,
          cornerId: axis.cornerId,
          sweepValues: Object.fromEntries(test.sweeps.filter((sweep) => sweep.enabled && sweep.variable in axis.values).map((sweep) => [sweep.variable, axis.values[sweep.variable]])),
          variableValues,
          temperatureC: axis.temperatureC ?? test.environment.temperatureC,
          monteCarloSample: axis.monteCarloSample,
          seed: axis.seed,
          label: `${test.name} / ${analysis.name} / ${axis.label}`,
        });
      }
    }
  }
  if (runPoints.length > 10_000) warnings.push(`The plan expands to ${runPoints.length.toLocaleString()} runs; review concurrency and output limits before execution.`);
  const analysisCost = runPoints.reduce((sum, point) => {
    const test = project.tests.find((candidate) => candidate.id === point.testId)!;
    const analysis = test.analyses.find((candidate) => candidate.id === point.analysisId)!;
    return sum + (analysis.type === "tran" ? 2.5 : analysis.type === "ac" || analysis.type === "noise" ? 1.2 : 0.35);
  }, 0);
  return {
    runPoints,
    totalRuns: runPoints.length,
    enabledTests: tests.length,
    analyses: tests.reduce((sum, test) => sum + test.analyses.filter((analysis) => analysis.enabled).length, 0),
    estimatedSeconds: Math.max(1, Math.ceil(analysisCost / Math.max(1, plan.concurrency))),
    estimatedOutputBytes: runPoints.length * 750_000,
    warnings,
  };
}

export function createRunPlan(project: SimulationProject, name: string, testIds: string[]): RunPlan {
  const now = new Date().toISOString();
  return {
    id: createId("runplan"),
    name,
    testIds,
    includeSweeps: true,
    includeCorners: true,
    includeMonteCarlo: false,
    concurrency: 2,
    stopOnFailure: false,
    createdAt: now,
    updatedAt: now,
  };
}
