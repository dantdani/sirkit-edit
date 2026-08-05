import { finalizeSimulation, simulationDigest, simulationId, unique } from "./stable";
import type { WaveformArtifact, WaveformSignal } from "./types";

export function createWaveformArtifact(input: { runId: string; axis: WaveformArtifact["axis"]; signals: Array<Omit<WaveformSignal, "deterministicDigest">>; rawOrDerivedState?: WaveformArtifact["rawOrDerivedState"]; parentArtifactRefs?: string[]; retentionAndLicensePolicy: string }): WaveformArtifact {
  const axisValues = [...input.axis.values]; const state = input.rawOrDerivedState ?? "lossless_normalized";
  const valid = axisValues.length > 0 && axisValues.every(Number.isFinite) && axisValues.every((value, index) => index === 0 || value > axisValues[index - 1]) && input.signals.length > 0 && input.signals.every((signal) => signal.values.length === axisValues.length && signal.values.every(Number.isFinite));
  const signals = input.signals.map((signal) => finalizeSimulation<WaveformSignal>({ ...structuredClone(signal), deterministicDigest: "" })).sort((a, b) => a.signalId.localeCompare(b.signalId));
  const immutableArtifactDigest = simulationDigest({ axis: { ...input.axis, values: axisValues }, signals, state });
  const body = { runId: input.runId, immutableArtifactDigest, formatAndSchema: "sirkit.waveform.v1" as const, axis: { ...input.axis, values: axisValues }, signals, rawOrDerivedState: state, parentArtifactRefs: unique(input.parentArtifactRefs ?? []), retentionAndLicensePolicy: input.retentionAndLicensePolicy, validationState: valid ? "valid" as const : "invalid" as const };
  return finalizeSimulation<WaveformArtifact>({ ...body, waveformArtifactId: simulationId("waveform", body), deterministicDigest: "" });
}

export function deriveDisplayWaveform(source: WaveformArtifact, maximumPoints: number): WaveformArtifact {
  if (source.validationState !== "valid" || source.rawOrDerivedState === "display_derived" || maximumPoints < 3) throw new Error("CD10_DISPLAY_WAVEFORM_SOURCE_INVALID");
  const count = source.axis.values.length; if (count <= maximumPoints) return createWaveformArtifact({ runId: source.runId, axis: source.axis, signals: source.signals, rawOrDerivedState: "display_derived", parentArtifactRefs: [source.waveformArtifactId], retentionAndLicensePolicy: source.retentionAndLicensePolicy });
  const bucket = Math.ceil(count / maximumPoints); const indices = new Set<number>([0, count - 1]);
  for (let start = 1; start < count - 1; start += bucket) { const end = Math.min(count - 1, start + bucket); for (const signal of source.signals) { let min = start, max = start; for (let i = start + 1; i < end; i++) { if (signal.values[i] < signal.values[min]) min = i; if (signal.values[i] > signal.values[max]) max = i; } indices.add(min); indices.add(max); } }
  const selected = [...indices].sort((a, b) => a - b).slice(0, maximumPoints);
  const artifact = createWaveformArtifact({ runId: source.runId, axis: { ...source.axis, values: selected.map((index) => source.axis.values[index]) }, signals: source.signals.map((signal) => ({ signalId: signal.signalId, semanticObjectId: signal.semanticObjectId, name: signal.name, unit: signal.unit, values: selected.map((index) => signal.values[index]) })), rawOrDerivedState: "display_derived", parentArtifactRefs: [source.waveformArtifactId], retentionAndLicensePolicy: source.retentionAndLicensePolicy });
  return finalizeSimulation({ ...artifact, compressionAndDownsamplingMetadata: { method: "multi-signal-min-max", sourcePointCount: count, resultPointCount: selected.length, authoritativeForMeasurement: false as const } });
}

export function validateWaveformArtifact(artifact: WaveformArtifact): string[] { const errors: string[] = []; if (artifact.formatAndSchema !== "sirkit.waveform.v1" || artifact.validationState !== "valid") errors.push("CD10_WAVEFORM_INVALID"); if (!artifact.axis.values.every((value, index) => Number.isFinite(value) && (index === 0 || value > artifact.axis.values[index - 1]))) errors.push("CD10_WAVEFORM_AXIS_INVALID"); if (artifact.signals.some((signal) => signal.values.length !== artifact.axis.values.length || signal.values.some((value) => !Number.isFinite(value)))) errors.push("CD10_WAVEFORM_SIGNAL_INVALID"); if (artifact.rawOrDerivedState === "display_derived" && artifact.compressionAndDownsamplingMetadata?.authoritativeForMeasurement !== false) errors.push("CD10_DISPLAY_WAVEFORM_AUTHORITY_INVALID"); if (artifact.deterministicDigest !== finalizeSimulation(artifact).deterministicDigest) errors.push("CD10_WAVEFORM_DIGEST_MISMATCH"); return unique(errors); }
