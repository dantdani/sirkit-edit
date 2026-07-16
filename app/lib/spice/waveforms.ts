import { createId } from "./identity";
import type { WaveformSeries } from "./types";
import { unitForVector } from "./units";

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

function parseHeader(lines: string[]): { header: RawHeader; valuesLine: number } {
  const header: RawHeader = { title: "", plotName: "Unknown", flags: "real", variableCount: 0, pointCount: 0, variables: [] };
  let valuesLine = -1;
  let inVariables = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("Title:")) header.title = line.slice(6).trim();
    else if (line.startsWith("Plotname:")) header.plotName = line.slice(9).trim();
    else if (line.startsWith("Flags:")) header.flags = line.slice(6).trim().toLowerCase();
    else if (line.startsWith("No. Variables:")) header.variableCount = Number.parseInt(line.slice(14).trim(), 10);
    else if (line.startsWith("No. Points:")) header.pointCount = Number.parseInt(line.slice(11).trim(), 10);
    else if (line.trim() === "Variables:") inVariables = true;
    else if (line.trim() === "Values:") {
      valuesLine = index + 1;
      break;
    } else if (inVariables) {
      const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)/);
      if (match) header.variables.push({ index: Number.parseInt(match[1], 10), name: match[2], type: match[3] });
    }
  }
  if (valuesLine < 0) throw new Error("ngspice raw file has no Values section");
  if (header.variableCount <= 0 || header.variables.length === 0) throw new Error("ngspice raw file has no variable declarations");
  return { header, valuesLine };
}

function numericTokens(lines: string[], start: number): number[] {
  const tokens: number[] = [];
  for (let index = start; index < lines.length; index++) {
    for (const token of lines[index].trim().split(/[\s,]+/)) {
      if (token === "") continue;
      const value = Number(token);
      if (Number.isFinite(value)) tokens.push(value);
    }
  }
  return tokens;
}

export function parseNgspiceAsciiRaw(raw: string): ParsedRawResult {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const { header, valuesLine } = parseHeader(lines);
  const complex = header.flags.includes("complex");
  const valuesPerVariable = complex ? 2 : 1;
  const stride = 1 + header.variableCount * valuesPerVariable;
  const tokens = numericTokens(lines, valuesLine);
  const availablePoints = Math.floor(tokens.length / stride);
  const pointCount = header.pointCount > 0 ? Math.min(header.pointCount, availablePoints) : availablePoints;
  const warnings: string[] = [];
  if (availablePoints < header.pointCount) warnings.push(`Raw file declared ${header.pointCount} points but only ${availablePoints} complete points were parsed.`);
  if (pointCount === 0) throw new Error("ngspice raw file contains no complete points");

  const xVariable = header.variables[0];
  const x: number[] = new Array(pointCount);
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
    const base = pointIndex * stride + 1;
    x[pointIndex] = tokens[base];
  }
  const waveforms: WaveformSeries[] = [];
  for (let variableIndex = 1; variableIndex < Math.min(header.variables.length, header.variableCount); variableIndex++) {
    const variable = header.variables[variableIndex];
    if (complex) {
      const real: number[] = new Array(pointCount);
      const imaginary: number[] = new Array(pointCount);
      const magnitudeDb: number[] = new Array(pointCount);
      const phaseDeg: number[] = new Array(pointCount);
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
        const offset = pointIndex * stride + 1 + variableIndex * 2;
        const re = tokens[offset];
        const im = tokens[offset + 1];
        real[pointIndex] = re;
        imaginary[pointIndex] = im;
        magnitudeDb[pointIndex] = 20 * Math.log10(Math.max(1e-30, Math.hypot(re, im)));
        phaseDeg[pointIndex] = Math.atan2(im, re) * 180 / Math.PI;
      }
      waveforms.push({
        id: createId("wave"),
        name: `${variable.name}.mag`,
        unit: "dB",
        xName: xVariable.name,
        xUnit: unitForVector(xVariable.name),
        x: [...x],
        y: magnitudeDb,
        complex: { real, imaginary, magnitudeDb, phaseDeg },
        sourceRefs: [],
      });
      waveforms.push({
        id: createId("wave"),
        name: `${variable.name}.phase`,
        unit: "°",
        xName: xVariable.name,
        xUnit: unitForVector(xVariable.name),
        x: [...x],
        y: phaseDeg,
        complex: { real, imaginary, magnitudeDb, phaseDeg },
        sourceRefs: [],
      });
    } else {
      const y: number[] = new Array(pointCount);
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
        y[pointIndex] = tokens[pointIndex * stride + 1 + variableIndex];
      }
      waveforms.push({
        id: createId("wave"),
        name: variable.name,
        unit: unitForVector(variable.name),
        xName: xVariable.name,
        xUnit: unitForVector(xVariable.name),
        x: [...x],
        y,
        sourceRefs: [],
      });
    }
  }
  // Operating-point decks can expose a single independent vector and no
  // dependent vectors. Preserve it so the result is still inspectable.
  if (waveforms.length === 0) {
    waveforms.push({
      id: createId("wave"),
      name: xVariable.name,
      unit: unitForVector(xVariable.name),
      xName: "index",
      xUnit: "",
      x: x.map((_, index) => index),
      y: x,
      sourceRefs: [],
    });
  }
  return { header, waveforms, warnings };
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
