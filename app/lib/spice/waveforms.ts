import { createId } from "./identity";
import type { WaveformSeries } from "./types";
import { SimulationOutputError, validateNgspiceAsciiOutput } from "@/app/lib/computation/output-validator";

interface RawHeader {
  title: string;
  plotName: string;
  flags: string;
  variableCount: number;
  pointCount: number;
  variables: Array<{ index: number; name: string; type: string }>;
}

export interface ParsedRawResult {
  header: RawHeader;
  waveforms: WaveformSeries[];
  warnings: string[];
}

/**
 * [B22-C] D22-10: the worker's parser routes through the one output validator (`app/lib/computation/output-validator.ts`, built
 * over CD-10's `createWaveformArtifact`). A non-finite value, a short or over-long values section, a misaligned point, a time or
 * frequency axis that does not strictly increase or a unit it cannot name refuses the file WHOLE (`SimulationOutputError`, a
 * closed code): this parser no longer drops a token, so no value can shift onto another variable, and `warnings` is always empty.
 * The legacy shape is kept: the first vector is `x`, a complex vector yields its magnitude (dB) and phase series.
 */
export function parseNgspiceAsciiRaw(raw: string): ParsedRawResult { // [B22 closeout, 2026-10-02] retired: the `options` parameter no caller passed (the validator's defaults apply)
  const output = validateNgspiceAsciiOutput(raw);
  const header: RawHeader = {
    title: output.title,
    plotName: output.plotName || "Unknown",
    flags: output.flags,
    variableCount: output.variables.length + 1,
    pointCount: output.points,
    variables: [output.axis, ...output.variables].map((vector, index) => ({ index, name: vector.name, type: vector.type })),
  };
  const x = [...output.axis.real];
  const waveforms: WaveformSeries[] = [];
  for (const variable of output.variables) {
    if (variable.imaginary) {
      const real = [...variable.real];
      const imaginary = [...variable.imaginary];
      const magnitudeDb = real.map((re, index) => 20 * Math.log10(Math.max(1e-30, Math.hypot(re, imaginary[index]!))));
      const phaseDeg = real.map((re, index) => Math.atan2(imaginary[index]!, re) * 180 / Math.PI);
      waveforms.push({ id: createId("wave"), name: `${variable.name}.mag`, unit: "dB", xName: output.axis.name, xUnit: output.axis.unit, x: [...x], y: magnitudeDb, complex: { real, imaginary, magnitudeDb, phaseDeg }, sourceRefs: [] });
      waveforms.push({ id: createId("wave"), name: `${variable.name}.phase`, unit: "°", xName: output.axis.name, xUnit: output.axis.unit, x: [...x], y: phaseDeg, complex: { real, imaginary, magnitudeDb, phaseDeg }, sourceRefs: [] });
    } else {
      waveforms.push({ id: createId("wave"), name: variable.name, unit: variable.unit, xName: output.axis.name, xUnit: output.axis.unit, x: [...x], y: [...variable.real], sourceRefs: [] });
    }
  }
  // Operating-point decks can expose a single independent vector and no
  // dependent vectors. Preserve it so the result is still inspectable.
  if (waveforms.length === 0) {
    waveforms.push({
      id: createId("wave"),
      name: output.axis.name,
      unit: output.axis.unit,
      xName: "index",
      xUnit: "",
      x: x.map((_, index) => index),
      y: x,
      sourceRefs: [],
    });
  }
  return { header, waveforms, warnings: [] };
}

/** [B22-C review] coverage-10: the worker's form - the parsed result, or the closed refusal as a value, so a refused output fails
 *  the run like every other failure (its logs, manifest and netlist kept) instead of throwing past them. */
export function parseNgspiceAsciiRawResult(raw: string): { ok: true; parsed: ParsedRawResult } | { ok: false; refusal: SimulationOutputError } { // [B22 closeout, 2026-10-02] retired: the `options` parameter no caller passed
  try {
    return { ok: true, parsed: parseNgspiceAsciiRaw(raw) };
  } catch (error) {
    if (error instanceof SimulationOutputError) return { ok: false, refusal: error };
    throw error;
  }
}

export interface DownsampledSeries {
  x: number[];
  y: number[];
  sourceIndexes: number[];
}

/**
 * Min/max envelope downsampling. It preserves spikes and bounds while keeping
 * visible data proportional to pixel width, which is better for engineering
 * waveforms than averaging or dropping every Nth sample.
 */
export function downsampleMinMax(x: number[], y: number[], targetPoints: number): DownsampledSeries {
  if (x.length !== y.length) throw new Error("Waveform x/y arrays have different lengths");
  if (targetPoints < 4 || x.length <= targetPoints) return { x: [...x], y: [...y], sourceIndexes: x.map((_, index) => index) };
  const bucketCount = Math.max(1, Math.floor((targetPoints - 2) / 2));
  const bucketSize = (x.length - 2) / bucketCount;
  const outX = [x[0]];
  const outY = [y[0]];
  const indexes = [0];
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = Math.max(1, Math.floor(1 + bucket * bucketSize));
    const end = Math.min(x.length - 1, Math.ceil(1 + (bucket + 1) * bucketSize));
    let minIndex = start;
    let maxIndex = start;
    for (let index = start + 1; index < end; index++) {
      if (y[index] < y[minIndex]) minIndex = index;
      if (y[index] > y[maxIndex]) maxIndex = index;
    }
    for (const index of minIndex < maxIndex ? [minIndex, maxIndex] : [maxIndex, minIndex]) {
      if (indexes.at(-1) === index) continue;
      outX.push(x[index]);
      outY.push(y[index]);
      indexes.push(index);
    }
  }
  if (indexes.at(-1) !== x.length - 1) {
    outX.push(x.at(-1)!);
    outY.push(y.at(-1)!);
    indexes.push(x.length - 1);
  }
  return { x: outX, y: outY, sourceIndexes: indexes };
}

export function sliceWaveform(series: WaveformSeries, from?: number, to?: number): WaveformSeries {
  const start = from === undefined ? 0 : lowerBound(series.x, from);
  const end = to === undefined ? series.x.length : Math.min(series.x.length, upperBound(series.x, to));
  return { ...series, x: series.x.slice(start, end), y: series.y.slice(start, end) };
}

function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

export interface SteadyStateWindow {
  detected: boolean;
  from: number;
  to: number;
  period?: number;
  cycles?: number;
  confidence: number;
  reason: string;
}

export function detectSteadyState(series: WaveformSeries, finalCycles = 5): SteadyStateWindow {
  if (series.x.length < 32) return { detected: false, from: series.x[0] ?? 0, to: series.x.at(-1) ?? 0, confidence: 0, reason: "Not enough samples" };
  const min = Math.min(...series.y);
  const max = Math.max(...series.y);
  const midpoint = (min + max) / 2;
  const crossings: number[] = [];
  for (let index = 1; index < series.y.length; index++) {
    if (series.y[index - 1] < midpoint && series.y[index] >= midpoint) {
      const fraction = (midpoint - series.y[index - 1]) / Math.max(Number.EPSILON, series.y[index] - series.y[index - 1]);
      crossings.push(series.x[index - 1] + fraction * (series.x[index] - series.x[index - 1]));
    }
  }
  if (crossings.length < finalCycles + 2) {
    const fromIndex = Math.floor(series.x.length * 0.8);
    return { detected: false, from: series.x[fromIndex], to: series.x.at(-1)!, confidence: 0.25, reason: "Periodic crossings were not stable; using final 20%" };
  }
  const periods = crossings.slice(1).map((crossing, index) => crossing - crossings[index]);
  const recent = periods.slice(-Math.max(finalCycles + 1, 6));
  const mean = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const deviation = Math.sqrt(recent.reduce((sum, value) => sum + (value - mean) ** 2, 0) / recent.length);
  const coefficient = mean > 0 ? deviation / mean : Number.POSITIVE_INFINITY;
  const to = series.x.at(-1)!;
  const from = Math.max(series.x[0], to - mean * finalCycles);
  const confidence = Math.max(0, Math.min(1, 1 - coefficient * 10));
  return {
    detected: coefficient < 0.03,
    from,
    to,
    period: mean,
    cycles: finalCycles,
    confidence,
    reason: coefficient < 0.03 ? `Final ${finalCycles} cycles have ${(coefficient * 100).toFixed(2)}% period variation` : "Cycle period has not stabilized",
  };
}

export function waveformDifference(a: WaveformSeries, b: WaveformSeries, percent = false): WaveformSeries {
  const count = Math.min(a.x.length, b.x.length);
  const x = a.x.slice(0, count);
  const y = new Array<number>(count);
  for (let index = 0; index < count; index++) {
    const bValue = interpolate(b.x, b.y, x[index]);
    const delta = a.y[index] - bValue;
    y[index] = percent ? delta / Math.max(Math.abs(bValue), 1e-30) * 100 : delta;
  }
  return {
    id: createId("wave"),
    name: `${a.name} ${percent ? "%Δ" : "Δ"} ${b.name}`,
    unit: percent ? "%" : a.unit,
    xName: a.xName,
    xUnit: a.xUnit,
    x,
    y,
    sourceRefs: [...a.sourceRefs, ...b.sourceRefs],
  };
}

export function interpolate(x: number[], y: number[], target: number): number {
  if (x.length === 0) return Number.NaN;
  const index = lowerBound(x, target);
  if (index <= 0) return y[0];
  if (index >= x.length) return y.at(-1)!;
  const fraction = (target - x[index - 1]) / Math.max(Number.EPSILON, x[index] - x[index - 1]);
  return y[index - 1] + fraction * (y[index] - y[index - 1]);
}
