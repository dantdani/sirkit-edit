import { createId, nowIso } from "./identity";
import { compileCanonicalIr, type CompileIrInput, type CompileIrResult } from "./ir";
import type { IrDevice, ReadinessIssue, ReadinessIssueCode, ReadinessReport, Severity, SourceRef } from "./types";
import { parseEngineeringValue } from "./units";

function issue(
  code: ReadinessIssueCode,
  severity: Severity,
  title: string,
  message: string,
  why: string,
  sourceRefs: SourceRef[] = [],
  fixes: ReadinessIssue["fixes"] = [],
): ReadinessIssue {
  return { id: createId("audit"), code, severity, title, message, why, sourceRefs, fixes };
}

function isIndependentSource(device: IrDevice): boolean {
  return device.deviceType === "V" || device.deviceType === "I";
}

function sourcePair(device: IrDevice): string {
  return device.pins.map((pin) => pin.nodeId).sort().join("|");
}

function requiredPinMapCount(device: IrDevice, modelPinCount: number): number {
  if (device.deviceType !== "X") return device.pins.length;
  return modelPinCount;
}

export function auditCompiledIr(compiled: CompileIrResult): ReadinessReport {
  const { ir } = compiled;
  const issues: ReadinessIssue[] = [];
  const ground = ir.nodes.find((node) => node.ground || node.name === "0");
  if (!ground) {
    issues.push(issue(
      "missing-ground",
      "error",
      "No ground reference",
      "The testbench has no node 0 reference.",
      "ngspice solves node voltages relative to node 0; without it the matrix is singular.",
      [],
      [{ kind: "guided", label: "Choose a reference net", operation: "select-ground-net" }],
    ));
  }

  const sources = ir.devices.filter(isIndependentSource);
  if (sources.length === 0) {
    issues.push(issue(
      "missing-source",
      "error",
      "No excitation source",
      "Neither the production schematic nor the overlay contains an independent source.",
      "Operating-point, AC, DC, and transient analyses need a defined excitation or bias condition.",
      [],
      [{ kind: "guided", label: "Add overlay source", operation: "add-overlay-source" }],
    ));
  }

  const duplicateNames = new Map<string, IrDevice[]>();
  for (const device of ir.devices) {
    const key = device.name.toUpperCase();
    duplicateNames.set(key, [...(duplicateNames.get(key) ?? []), device]);
  }
  for (const [name, devices] of duplicateNames) {
    if (devices.length < 2) continue;
    issues.push(issue(
      "duplicate-reference",
      "error",
      `Duplicate reference ${name}`,
      `${devices.length} devices compile to the same ngspice element name.`,
      "ngspice element identifiers must be unique; duplicates silently overwrite intent or stop parsing.",
      devices.map((device) => device.source),
      [{ kind: "guided", label: "Rename references", operation: "rename-duplicate-references", payload: { name } }],
    ));
  }

  const devicesByNode = new Map<string, IrDevice[]>();
  for (const device of ir.devices) {
    for (const pin of device.pins) devicesByNode.set(pin.nodeId, [...(devicesByNode.get(pin.nodeId) ?? []), device]);
  }
  for (const node of ir.nodes) {
    const connected = devicesByNode.get(node.id) ?? [];
    if (node.ground || connected.length !== 1) continue;
    const source = connected[0].source;
    issues.push(issue(
      "floating-node",
      "warning",
      `Likely floating node ${node.name}`,
      `${node.name} touches only ${connected[0].name}.`,
      "A one-terminal electrical island often produces a singular matrix or a misleading unconstrained voltage.",
      [source, ...node.sourceRefs],
      [{ kind: "guided", label: "Inspect connection", operation: "focus-source", payload: source }],
    ));
  }

  const voltagePairs = new Map<string, IrDevice[]>();
  for (const device of sources.filter((candidate) => candidate.deviceType === "V")) {
    if (device.pins.length >= 2 && device.pins[0].nodeId === device.pins[1].nodeId) {
      issues.push(issue(
        "ideal-source-loop",
        "error",
        `${device.name} is shorted across one node`,
        "Both source terminals resolve to the same electrical net.",
        "An ideal non-zero voltage across zero impedance is physically inconsistent.",
        [device.source],
        [{ kind: "guided", label: "Inspect source wiring", operation: "focus-source", payload: device.source }],
      ));
    }
    const pair = sourcePair(device);
    voltagePairs.set(pair, [...(voltagePairs.get(pair) ?? []), device]);
  }
  for (const devices of voltagePairs.values()) {
    if (devices.length < 2) continue;
    issues.push(issue(
      "ideal-source-loop",
      "error",
      "Parallel ideal voltage sources",
      `${devices.map((device) => device.name).join(", ")} are directly connected across the same nodes.`,
      "Conflicting ideal voltage constraints form a zero-impedance source loop and prevent a unique operating point.",
      devices.map((device) => device.source),
      [{ kind: "guided", label: "Add realistic source resistance", operation: "add-source-resistance" }],
    ));
  }

  for (const device of ir.devices) {
    if (device.deviceType === "X" && !device.modelId) {
      issues.push(issue(
        "missing-model",
        "error",
        `${device.name} has no simulation model`,
        "The KiCad symbol is present, but no governed model asset is assigned.",
        "Symbols describe drawing and pin identity; they do not guarantee electrical behavior.",
        [device.source],
        [{ kind: "guided", label: "Assign model", operation: "open-model-assignment", payload: { componentId: device.id } }],
      ));
      continue;
    }
    if (device.modelId) {
      const model = ir.models.find((candidate) => candidate.id === device.modelId);
      if (!model) {
        issues.push(issue("missing-model", "error", `${device.name} model asset is missing`, `Binding references ${device.modelId}, but the asset is unavailable.`, "A run cannot package or checksum a model that is not present.", [device.source]));
        continue;
      }
      if (model.provenance === "ai-approximation" || model.validationStatus === "unverified") {
        issues.push(issue(
          "approximate-model",
          "warning",
          `${device.name} uses an approximate model`,
          `${model.name} is ${model.provenance === "ai-approximation" ? "AI-generated" : "unverified"}.`,
          "Approximate models are useful for architecture studies but must not be presented as signoff evidence.",
          [device.source, { kind: "model", id: model.id, label: model.name }],
        ));
      }
      if (model.externalPins.length > 0 && device.pins.length !== requiredPinMapCount(device, model.externalPins.length)) {
        issues.push(issue(
          "pin-map-mismatch",
          "error",
          `${device.name} pin mapping is incomplete`,
          `The model exposes ${model.externalPins.length} pins, but ${device.pins.length} mapped pins are available.`,
          "A shifted or missing pin map can produce plausible-looking but electrically wrong simulation results.",
          [device.source, { kind: "model", id: model.id, label: model.name }],
          [{ kind: "guided", label: "Review pin map", operation: "open-pin-map", payload: { componentId: device.id, modelId: model.id } }],
        ));
      }
      for (const analysis of ir.analyses) {
        if (model.unsupportedAnalyses.includes(analysis.type)) {
          issues.push(issue(
            "unsupported-model",
            "error",
            `${model.name} does not support ${analysis.type.toUpperCase()}`,
            `The assigned model declares ${analysis.type} unsupported.`,
            "Using a model outside its validated analysis modes can yield errors or invalid conclusions.",
            [device.source, { kind: "analysis", id: analysis.id, label: analysis.name }, { kind: "model", id: model.id, label: model.name }],
          ));
        }
      }
    }

    if (device.value && !/^(?:pulse|pwl|sin|exp|sffm|am|random|external|dc|ac)\b/i.test(device.value.trim()) && !/^\{[^}]+\}$/.test(device.value.trim())) {
      const expected = device.deviceType === "R" ? "resistance" : device.deviceType === "C" ? "capacitance" : device.deviceType === "L" ? "inductance" : undefined;
      if (expected && !parseEngineeringValue(device.value, expected)) {
        issues.push(issue(
          "invalid-value",
          "error",
          `${device.name} has an invalid value`,
          `“${device.value}” could not be parsed as ${expected}.`,
          "Ambiguous or malformed engineering values can change a circuit by orders of magnitude.",
          [device.source],
        ));
      }
    }
  }

  const loads = ir.devices.filter((device) => ["R", "C", "L", "D", "Q", "M", "X"].includes(device.deviceType));
  if (sources.length > 0 && loads.length === 0) {
    issues.push(issue(
      "missing-load",
      "warning",
      "No electrical load detected",
      "The testbench contains a source but no passive or modeled load.",
      "Unloaded sources rarely represent the operating condition that determines startup, stability, ripple, or power.",
      sources.map((source) => source.source),
      [{ kind: "guided", label: "Add overlay load", operation: "add-overlay-load" }],
    ));
  }

  if (ir.outputs.length === 0) {
    issues.push(issue(
      "missing-output",
      "warning",
      "No saved outputs",
      "The run is configured without signals to save.",
      "Save-vector minimization is useful, but at least one signal is needed for waveform inspection and evidence.",
      [],
      [{ kind: "automatic", label: "Save all node voltages", operation: "add-default-output" }],
    ));
  }

  const hasTransient = ir.analyses.some((analysis) => analysis.type === "tran");
  const hasSwitchingSource = ir.devices.some((device) => isIndependentSource(device) && /\b(?:pulse|pwl)\s*\(/i.test(device.value ?? ""));
  if (hasSwitchingSource && !hasTransient) {
    issues.push(issue(
      "analysis-incompatible",
      "warning",
      "Switching stimulus without transient analysis",
      "A PULSE/PWL source is present, but no enabled transient analysis will observe its time-domain behavior.",
      "Operating-point and AC analyses linearize or ignore time-domain switching waveforms.",
      ir.devices.filter((device) => /\b(?:pulse|pwl)\s*\(/i.test(device.value ?? "")).map((device) => device.source),
      [{ kind: "automatic", label: "Add transient analysis", operation: "add-transient-analysis" }],
    ));
  }

  const blocking = issues.filter((item) => item.severity === "error").length;
  return {
    ready: blocking === 0,
    blocking,
    warnings: issues.filter((item) => item.severity === "warning").length,
    infos: issues.filter((item) => item.severity === "info").length,
    checkedAt: nowIso(),
    issues,
  };
}

export function auditSimulationReadiness(input: CompileIrInput): { compiled: CompileIrResult; report: ReadinessReport } {
  const compiled = compileCanonicalIr(input);
  return { compiled, report: auditCompiledIr(compiled) };
}
