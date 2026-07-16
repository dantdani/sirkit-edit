import { createId } from "./identity";
import type { Measurement, ScalarResult, Specification, WaveformSeries } from "./types";
import { parseEngineeringValue } from "./units";
import { detectSteadyState, interpolate, sliceWaveform } from "./waveforms";

export interface MeasurementContext {
  runId: string;
  waveforms: WaveformSeries[];
  autoSteadyState?: boolean;
  finalCycles?: number;
}

function findSeries(waveforms: WaveformSeries[], expression: string): WaveformSeries {
  const normalized = expression.trim().toLowerCase();
  const aliases = [
    normalized,
    normalized.replace(/^db\((.+)\)$/, "$1.mag"),
    normalized.replace(/^phase\((.+)\)$/, "$1.phase"),
  ];
  const exact = waveforms.find((series) => aliases.includes(series.name.toLowerCase()));
  if (exact) return exact;
  const loose = waveforms.find((series) => aliases.some((alias) => series.name.toLowerCase().endsWith(alias)));
  if (loose) return loose;
  throw new Error(`Waveform “${expression}” was not found`);
}

function axisValue(raw: string | undefined, fallback: number | undefined): number | undefined {
  if (!raw) return fallback;
  return parseEngineeringValue(raw)?.value ?? Number(raw);
}

function windowed(measurement: Measurement, series: WaveformSeries, context: MeasurementContext): WaveformSeries {
  let from = axisValue(measurement.from, undefined);
  let to = axisValue(measurement.to, undefined);
  if (context.autoSteadyState && from === undefined && to === undefined && series.xName.toLowerCase() === "time") {
    const window = detectSteadyState(series, context.finalCycles ?? 5);
    from = window.from;
    to = window.to;
  }
  const sliced = sliceWaveform(series, from, to);
  if (sliced.x.length === 0) throw new Error(`Measurement window contains no ${series.name} samples`);
  return sliced;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function rms(values: number[]): number {
  return Math.sqrt(average(values.map((value) => value * value)));
}

function trapezoid(x: number[], y: number[]): number {
  let area = 0;
  for (let index = 1; index < Math.min(x.length, y.length); index++) area += (x[index] - x[index - 1]) * (y[index] + y[index - 1]) / 2;
  return area;
}

function derivatives(series: WaveformSeries): number[] {
  const values: number[] = [];
  for (let index = 1; index < series.x.length; index++) {
    const dx = series.x[index] - series.x[index - 1];
    if (dx !== 0) values.push((series.y[index] - series.y[index - 1]) / dx);
  }
  return values;
}

function crossingTimes(series: WaveformSeries, threshold: number, rising?: boolean): number[] {
  const crossings: number[] = [];
  for (let index = 1; index < series.y.length; index++) {
    const before = series.y[index - 1] - threshold;
    const after = series.y[index] - threshold;
    const matchesDirection = rising === undefined || (rising ? before < 0 && after >= 0 : before > 0 && after <= 0);
    if (!matchesDirection || before === after || before * after > 0) continue;
    const fraction = -before / (after - before);
    crossings.push(series.x[index - 1] + fraction * (series.x[index] - series.x[index - 1]));
  }
  return crossings;
}

function riseOrFallTime(series: WaveformSeries, falling: boolean): { value: number; markers: ScalarResult["markers"] } {
  const min = Math.min(...series.y);
  const max = Math.max(...series.y);
  const low = min + 0.1 * (max - min);
  const high = min + 0.9 * (max - min);
  const first = crossingTimes(series, falling ? high : low, !falling)[0];
  const second = crossingTimes(series, falling ? low : high, !falling).find((time) => time >= first);
  if (first === undefined || second === undefined) throw new Error(`${falling ? "Fall" : "Rise"} thresholds were not crossed`);
  return {
    value: second - first,
    markers: [
      { series: series.name, x: first, y: falling ? high : low, label: falling ? "90%" : "10%" },
      { series: series.name, x: second, y: falling ? low : high, label: falling ? "10%" : "90%" },
    ],
  };
}

function settlingTime(series: WaveformSeries, tolerance = 0.02): { value: number; markers: ScalarResult["markers"] } {
  const tail = series.y.slice(Math.floor(series.y.length * 0.95));
  const target = average(tail);
  const band = Math.max(Math.abs(target) * tolerance, (Math.max(...series.y) - Math.min(...series.y)) * tolerance * 0.1, 1e-15);
  let settledIndex = series.y.length - 1;
  for (let index = series.y.length - 1; index >= 0; index--) {
    if (Math.abs(series.y[index] - target) > band) {
      settledIndex = Math.min(series.y.length - 1, index + 1);
      break;
    }
  }
  return {
    value: series.x[settledIndex] - series.x[0],
    markers: [{ series: series.name, x: series.x[settledIndex], y: series.y[settledIndex], label: `Settled ±${(tolerance * 100).toFixed(1)}%` }],
  };
}

function bandwidth(series: WaveformSeries): { value: number; markers: ScalarResult["markers"] } {
  const peak = Math.max(...series.y);
  const threshold = peak - 3;
  const index = series.y.findIndex((value) => value <= threshold);
  if (index < 1) throw new Error("No -3 dB bandwidth crossing was found");
  const x = linearCross(series.x[index - 1], series.y[index - 1], series.x[index], series.y[index], threshold);
  return { value: x, markers: [{ series: series.name, x, y: threshold, label: "-3 dB" }] };
}

function linearCross(x1: number, y1: number, x2: number, y2: number, target: number): number {
  return x1 + (target - y1) / Math.max(Number.EPSILON, y2 - y1) * (x2 - x1);
}

function unityGain(series: WaveformSeries): { value: number; markers: ScalarResult["markers"] } {
  for (let index = 1; index < series.y.length; index++) {
    if ((series.y[index - 1] >= 0 && series.y[index] <= 0) || (series.y[index - 1] <= 0 && series.y[index] >= 0)) {
      const x = linearCross(series.x[index - 1], series.y[index - 1], series.x[index], series.y[index], 0);
      return { value: x, markers: [{ series: series.name, x, y: 0, label: "0 dB" }] };
    }
  }
  throw new Error("No unity-gain crossing was found");
}

function phaseMargin(magnitude: WaveformSeries, phase: WaveformSeries): { value: number; markers: ScalarResult["markers"] } {
  const crossing = unityGain(magnitude);
  const frequency = crossing.value;
  const phaseAt = interpolate(phase.x, phase.y, frequency);
  return { value: 180 + phaseAt, markers: [...(crossing.markers ?? []), { series: phase.name, x: frequency, y: phaseAt, label: "Phase at crossover" }] };
}

function gainMargin(magnitude: WaveformSeries, phase: WaveformSeries): { value: number; markers: ScalarResult["markers"] } {
  for (let index = 1; index < phase.y.length; index++) {
    if ((phase.y[index - 1] > -180 && phase.y[index] <= -180) || (phase.y[index - 1] < -180 && phase.y[index] >= -180)) {
      const frequency = linearCross(phase.x[index - 1], phase.y[index - 1], phase.x[index], phase.y[index], -180);
      const gain = interpolate(magnitude.x, magnitude.y, frequency);
      return { value: -gain, markers: [{ series: phase.name, x: frequency, y: -180, label: "-180°" }, { series: magnitude.name, x: frequency, y: gain, label: "Gain at phase crossover" }] };
    }
  }
  throw new Error("No -180° phase crossing was found");
}

function thd(series: WaveformSeries): number {
  const count = series.y.length;
  if (count < 16) throw new Error("THD requires at least 16 samples");
  const mean = average(series.y);
  const values = series.y.map((value) => value - mean);
  const maxHarmonic = Math.min(20, Math.floor(count / 2) - 1);
  const magnitudes: number[] = [];
  for (let harmonic = 1; harmonic <= maxHarmonic; harmonic++) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < count; index++) {
      const angle = -2 * Math.PI * harmonic * index / count;
      real += values[index] * Math.cos(angle);
      imaginary += values[index] * Math.sin(angle);
    }
    magnitudes.push(Math.hypot(real, imaginary) / count * 2);
  }
  const fundamental = magnitudes[0];
  if (!fundamental) throw new Error("THD fundamental is zero");
  return Math.sqrt(magnitudes.slice(1).reduce((sum, value) => sum + value * value, 0)) / fundamental * 100;
}

function pointwiseBinary(primary: WaveformSeries, secondary: WaveformSeries, operator: "*" | "/" | "+" | "-"): number[] {
  return primary.x.map((x, index) => {
    const a = primary.y[index];
    const b = interpolate(secondary.x, secondary.y, x);
    if (operator === "*") return a * b;
    if (operator === "/") return a / b;
    if (operator === "+") return a + b;
    return a - b;
  });
}

function result(
  context: MeasurementContext,
  measurement: Measurement,
  value: number | undefined,
  unit: string | undefined,
  markers?: ScalarResult["markers"],
  error?: string,
): ScalarResult {
  return {
    id: createId("scalar"),
    runId: context.runId,
    measurementId: measurement.id,
    name: measurement.name,
    value,
    unit,
    status: error ? "error" : "not-evaluated",
    message: error,
    markers,
  };
}

export function evaluateMeasurement(measurement: Measurement, context: MeasurementContext): ScalarResult {
  try {
    const primary = windowed(measurement, findSeries(context.waveforms, measurement.expression), context);
    const secondary = measurement.secondaryExpression
      ? windowed(measurement, findSeries(context.waveforms, measurement.secondaryExpression), context)
      : undefined;
    const values = primary.y;
    let value: number;
    let unit = measurement.unit || primary.unit;
    let markers: ScalarResult["markers"];
    switch (measurement.operator) {
      case "min": value = Math.min(...values); break;
      case "max": value = Math.max(...values); break;
      case "average": value = average(values); break;
      case "rms": value = rms(values); break;
      case "peak-to-peak":
      case "ripple": value = Math.max(...values) - Math.min(...values); break;
      case "integral": value = trapezoid(primary.x, values); unit = measurement.unit || `${primary.unit}·${primary.xUnit}`; break;
      case "derivative":
      case "slew-rate": value = Math.max(...derivatives(primary).map(Math.abs)); unit = measurement.unit || `${primary.unit}/${primary.xUnit}`; break;
      case "value-at": {
        const at = axisValue(measurement.at, measurement.threshold);
        if (at === undefined) throw new Error("value-at requires an at coordinate");
        value = interpolate(primary.x, values, at);
        markers = [{ series: primary.name, x: at, y: value, label: measurement.name }];
        break;
      }
      case "crossing": {
        const threshold = measurement.threshold ?? 0;
        const crossings = crossingTimes(primary, threshold);
        const nth = Math.max(1, measurement.nth ?? 1);
        value = crossings[nth - 1];
        if (value === undefined) throw new Error(`Crossing #${nth} was not found`);
        unit = primary.xUnit;
        markers = [{ series: primary.name, x: value, y: threshold, label: `Crossing #${nth}` }];
        break;
      }
      case "rise-time": ({ value, markers } = riseOrFallTime(primary, false)); unit = primary.xUnit; break;
      case "fall-time": ({ value, markers } = riseOrFallTime(primary, true)); unit = primary.xUnit; break;
      case "propagation-delay": {
        if (!secondary) throw new Error("Propagation delay requires a secondary expression");
        const threshold = measurement.threshold ?? (Math.min(...values) + Math.max(...values)) / 2;
        const primaryCross = crossingTimes(primary, threshold)[0];
        const secondaryThreshold = measurement.threshold ?? (Math.min(...secondary.y) + Math.max(...secondary.y)) / 2;
        const secondaryCross = crossingTimes(secondary, secondaryThreshold)[0];
        if (primaryCross === undefined || secondaryCross === undefined) throw new Error("Propagation thresholds were not crossed");
        value = secondaryCross - primaryCross;
        unit = primary.xUnit;
        markers = [{ series: primary.name, x: primaryCross, y: threshold, label: "Input" }, { series: secondary.name, x: secondaryCross, y: secondaryThreshold, label: "Output" }];
        break;
      }
      case "pulse-width": {
        const threshold = measurement.threshold ?? (Math.min(...values) + Math.max(...values)) / 2;
        const rising = crossingTimes(primary, threshold, true)[0];
        const falling = crossingTimes(primary, threshold, false).find((time) => time > rising);
        if (rising === undefined || falling === undefined) throw new Error("A complete pulse was not found");
        value = falling - rising;
        unit = primary.xUnit;
        break;
      }
      case "duty-cycle": {
        const threshold = measurement.threshold ?? (Math.min(...values) + Math.max(...values)) / 2;
        let highTime = 0;
        for (let index = 1; index < values.length; index++) if ((values[index] + values[index - 1]) / 2 >= threshold) highTime += primary.x[index] - primary.x[index - 1];
        value = highTime / Math.max(Number.EPSILON, primary.x.at(-1)! - primary.x[0]) * 100;
        unit = "%";
        break;
      }
      case "overshoot": {
        const final = average(values.slice(Math.floor(values.length * 0.95)));
        value = (Math.max(...values) - final) / Math.max(Math.abs(final), 1e-30) * 100;
        unit = "%";
        break;
      }
      case "undershoot": {
        const final = average(values.slice(Math.floor(values.length * 0.95)));
        value = (final - Math.min(...values)) / Math.max(Math.abs(final), 1e-30) * 100;
        unit = "%";
        break;
      }
      case "settling-time": ({ value, markers } = settlingTime(primary, measurement.tolerance ?? 0.02)); unit = primary.xUnit; break;
      case "gain": value = primary.unit === "dB" ? Math.max(...values) : 20 * Math.log10(Math.max(1e-30, Math.abs(average(values)))); unit = "dB"; break;
      case "phase": value = interpolate(primary.x, values, axisValue(measurement.at, primary.x.at(-1))!); unit = "°"; break;
      case "bandwidth": ({ value, markers } = bandwidth(primary)); unit = primary.xUnit; break;
      case "unity-gain-frequency": ({ value, markers } = unityGain(primary)); unit = primary.xUnit; break;
      case "phase-margin": {
        if (!secondary) throw new Error("Phase margin requires magnitude and phase expressions");
        ({ value, markers } = phaseMargin(primary, secondary)); unit = "°"; break;
      }
      case "gain-margin": {
        if (!secondary) throw new Error("Gain margin requires magnitude and phase expressions");
        ({ value, markers } = gainMargin(primary, secondary)); unit = "dB"; break;
      }
      case "impedance": {
        if (!secondary) throw new Error("Impedance requires voltage and current expressions");
        value = rms(values) / Math.max(1e-30, rms(secondary.y)); unit = "Ω"; break;
      }
      case "average-power":
      case "peak-power": {
        if (!secondary) throw new Error("Power requires voltage and current expressions");
        const power = pointwiseBinary(primary, secondary, "*");
        value = measurement.operator === "average-power" ? average(power) : Math.max(...power.map(Math.abs)); unit = "W"; break;
      }
      case "energy": {
        if (!secondary) throw new Error("Energy requires voltage and current expressions");
        value = trapezoid(primary.x, pointwiseBinary(primary, secondary, "*")); unit = "J"; break;
      }
      case "thd": value = thd(primary); unit = "%"; break;
      case "integrated-noise": value = Math.sqrt(Math.max(0, trapezoid(primary.x, values.map((sample) => sample * sample)))); unit = measurement.unit || primary.unit; break;
      case "formula": {
        if (!secondary) {
          value = average(values);
        } else {
          const formula = measurement.formula?.trim() ?? "a/b";
          const operator = formula.includes("*") ? "*" : formula.includes("/") ? "/" : formula.includes("+") ? "+" : "-";
          value = average(pointwiseBinary(primary, secondary, operator));
        }
        break;
      }
    }
    if (!Number.isFinite(value)) throw new Error("Measurement produced a non-finite value");
    return result(context, measurement, value, unit, markers);
  } catch (error) {
    return result(context, measurement, undefined, measurement.unit, undefined, error instanceof Error ? error.message : String(error));
  }
}

function compare(value: number, specification: Specification): boolean {
  switch (specification.comparison) {
    case "<": return value < specification.limit;
    case "<=": return value <= specification.limit;
    case ">": return value > specification.limit;
    case ">=": return value >= specification.limit;
    case "between": return value >= specification.limit && value <= (specification.upperLimit ?? specification.limit);
    case "outside": return value < specification.limit || value > (specification.upperLimit ?? specification.limit);
  }
}

export function evaluateSpecifications(
  runId: string,
  specifications: Specification[],
  measurements: ScalarResult[],
  testId: string,
): ScalarResult[] {
  return specifications.filter((specification) => specification.enabled && (specification.applicableTestIds.length === 0 || specification.applicableTestIds.includes(testId))).map((specification) => {
    const source = measurements.find((measurement) => measurement.measurementId === specification.measurementId);
    if (!source || source.value === undefined || source.status === "error") {
      return {
        id: createId("scalar"),
        runId,
        measurementId: specification.measurementId,
        specificationId: specification.id,
        name: specification.name,
        unit: specification.unit,
        status: source?.status === "error" ? "error" : "not-evaluated",
        message: source?.message ?? "Measurement was not evaluated",
      };
    }
    const passed = compare(source.value, specification);
    return {
      ...source,
      id: createId("scalar"),
      specificationId: specification.id,
      name: specification.name,
      unit: specification.unit || source.unit,
      status: passed ? "pass" : specification.severity === "warning" ? "warning" : "fail",
      message: passed
        ? `Passed ${specification.comparison} ${specification.limit}${specification.upperLimit !== undefined ? `..${specification.upperLimit}` : ""} ${specification.unit}`
        : `Measured ${source.value} ${source.unit ?? ""}; required ${specification.comparison} ${specification.limit}${specification.upperLimit !== undefined ? `..${specification.upperLimit}` : ""} ${specification.unit}`,
    };
  });
}

export function evaluateTestResults(
  runId: string,
  testId: string,
  measurements: Measurement[],
  specifications: Specification[],
  waveforms: WaveformSeries[],
  options: { autoSteadyState?: boolean; finalCycles?: number } = {},
): ScalarResult[] {
  const scalarMeasurements = measurements.filter((measurement) => measurement.enabled).map((measurement) => evaluateMeasurement(measurement, { runId, waveforms, ...options }));
  return [...scalarMeasurements, ...evaluateSpecifications(runId, specifications, scalarMeasurements, testId)];
}

export interface StatisticalSummary {
  count: number;
  failures: number;
  yieldPercent: number;
  mean: number;
  standardDeviation: number;
  min: number;
  max: number;
  percentiles: Record<string, number>;
  outlierRunIds: string[];
}

export function summarizeScalars(results: ScalarResult[]): StatisticalSummary | null {
  const valid = results.filter((result): result is ScalarResult & { value: number } => typeof result.value === "number" && Number.isFinite(result.value));
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a.value - b.value);
  const mean = average(sorted.map((result) => result.value));
  const standardDeviation = Math.sqrt(average(sorted.map((result) => (result.value - mean) ** 2)));
  const percentile = (p: number) => {
    const index = (sorted.length - 1) * p;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    if (low === high) return sorted[low].value;
    return sorted[low].value + (index - low) * (sorted[high].value - sorted[low].value);
  };
  return {
    count: valid.length,
    failures: valid.filter((result) => result.status === "fail" || result.status === "error").length,
    yieldPercent: valid.filter((result) => result.status === "pass" || result.status === "not-evaluated").length / valid.length * 100,
    mean,
    standardDeviation,
    min: sorted[0].value,
    max: sorted.at(-1)!.value,
    percentiles: { p1: percentile(0.01), p5: percentile(0.05), p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
    outlierRunIds: valid.filter((result) => standardDeviation > 0 && Math.abs(result.value - mean) > 3 * standardDeviation).map((result) => result.runId),
  };
}
