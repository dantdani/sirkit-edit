import type {
  CanonicalSimulationIr,
  IrDevice,
  NetlistBundle,
  NetlistSourceMapEntry,
  RunPoint,
  SimulationAnalysis,
  SourceRef,
} from "./types";
import { toSpiceValue } from "./units";

export interface CompileNetlistOptions {
  analysisId?: string;
  runPoint?: RunPoint;
  rawOutputPath?: string;
  modelPaths?: Record<string, string>;
  pinNodes?: Record<string, string>;
}

interface LineWriter {
  lines: string[];
  sourceMap: NetlistSourceMapEntry[];
  push(text: string | string[], source?: SourceRef): void;
}

function createWriter(): LineWriter {
  const lines: string[] = [];
  const sourceMap: NetlistSourceMapEntry[] = [];
  return {
    lines,
    sourceMap,
    push(text, source) {
      const block = Array.isArray(text) ? text : text.split(/\r?\n/);
      const start = lines.length + 1;
      lines.push(...block);
      if (source) {
        sourceMap.push({
          lineStart: start,
          lineEnd: lines.length,
          source,
          generatedText: block.join("\n"),
        });
      }
    },
  };
}

function modelText(model: CanonicalSimulationIr["models"][number]): string {
  return model.transformedContent?.trim() || model.originalContent.trim();
}

function nodeName(ir: CanonicalSimulationIr, nodeId: string): string {
  const node = ir.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`IR references missing node ${nodeId}`);
  return node.ground ? "0" : node.name;
}

function safeParamName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(cleaned)) return `P_${cleaned}`;
  return cleaned;
}

function valueFor(device: IrDevice): string {
  const raw = device.value?.trim() || "0";
  const dimension = device.deviceType === "R" ? "resistance" : device.deviceType === "C" ? "capacitance" : device.deviceType === "L" ? "inductance" : undefined;
  return toSpiceValue(raw, dimension);
}

function emitDevice(ir: CanonicalSimulationIr, device: IrDevice): string {
  const nodes = device.pins.map((pin) => nodeName(ir, pin.nodeId));
  const params = Object.entries(device.parameters).map(([key, value]) => `${safeParamName(key)}=${toSpiceValue(value)}`).join(" ");
  const suffix = params ? ` ${params}` : "";
  const value = valueFor(device);
  switch (device.deviceType) {
    case "R":
    case "C":
    case "L":
      return `${device.name} ${nodes.join(" ")} ${value}${suffix}`;
    case "V":
      return `${device.name} ${nodes.join(" ")} ${sourceValue(value, true)}${suffix}`;
    case "I":
      return `${device.name} ${nodes.join(" ")} ${sourceValue(value, false)}${suffix}`;
    case "D":
    case "Q":
    case "M":
      if (!device.modelName) throw new Error(`${device.name} is missing a model name`);
      return `${device.name} ${nodes.join(" ")} ${device.modelName}${suffix}`;
    case "X":
      if (!device.modelName) throw new Error(`${device.name} is missing a subcircuit model name`);
      return `${device.name} ${nodes.join(" ")} ${device.modelName}${suffix}`;
    case "B":
      return `${device.name} ${nodes.join(" ")} ${value}${suffix}`;
  }
}

function sourceValue(value: string, includeAc: boolean): string {
  if (/^(?:dc|ac|pulse|pwl|sin|exp|sffm|am|random|external)\b/i.test(value)) return value;
  return includeAc ? `DC ${value} AC 1` : `DC ${value}`;
}

function activeAnalysis(ir: CanonicalSimulationIr, analysisId?: string): SimulationAnalysis {
  const analysis = analysisId
    ? ir.analyses.find((candidate) => candidate.id === analysisId)
    : ir.analyses[0];
  if (!analysis) throw new Error("No enabled simulation analysis was selected");
  return analysis;
}

export function analysisDirective(analysis: SimulationAnalysis): string[] {
  switch (analysis.type) {
    case "op":
      return [".op"];
    case "dc": {
      const primary = `${analysis.source} ${toSpiceValue(analysis.start)} ${toSpiceValue(analysis.stop)} ${toSpiceValue(analysis.step)}`;
      const nested = analysis.nested
        ? ` ${analysis.nested.source} ${toSpiceValue(analysis.nested.start)} ${toSpiceValue(analysis.nested.stop)} ${toSpiceValue(analysis.nested.step)}`
        : "";
      return [`.dc ${primary}${nested}`];
    }
    case "ac":
      return [`.ac ${analysis.scale} ${Math.max(1, Math.round(analysis.points))} ${toSpiceValue(analysis.startFrequency, "frequency")} ${toSpiceValue(analysis.stopFrequency, "frequency")}`];
    case "tran": {
      const args = [
        toSpiceValue(analysis.outputStep, "time"),
        toSpiceValue(analysis.stopTime, "time"),
        analysis.startTime ? toSpiceValue(analysis.startTime, "time") : undefined,
        analysis.maxStep ? toSpiceValue(analysis.maxStep, "time") : undefined,
      ].filter((value): value is string => Boolean(value));
      return [`.tran ${args.join(" ")}${analysis.useInitialConditions ? " uic" : ""}`];
    }
    case "noise":
      return [`.noise ${analysis.output} ${analysis.inputSource} ${analysis.scale} ${Math.max(1, Math.round(analysis.points))} ${toSpiceValue(analysis.startFrequency, "frequency")} ${toSpiceValue(analysis.stopFrequency, "frequency")}${analysis.pointsPerSummary ? ` ${Math.round(analysis.pointsPerSummary)}` : ""}`];
    case "tf":
      return [`.tf ${analysis.output} ${analysis.inputSource}`];
    case "pz":
      return [`.pz ${analysis.inputPositive} ${analysis.inputNegative} ${analysis.outputPositive} ${analysis.outputNegative} ${analysis.transfer} ${analysis.calculation}`];
    case "sens":
      return [analysis.ac
        ? `.sens ${analysis.output} ac ${analysis.ac.scale} ${Math.max(1, Math.round(analysis.ac.points))} ${toSpiceValue(analysis.ac.start, "frequency")} ${toSpiceValue(analysis.ac.stop, "frequency")}`
        : `.sens ${analysis.output}`];
    case "disto":
      return [`.disto ${analysis.scale} ${Math.max(1, Math.round(analysis.points))} ${toSpiceValue(analysis.startFrequency, "frequency")} ${toSpiceValue(analysis.stopFrequency, "frequency")}${analysis.f2overF1 ? ` ${analysis.f2overF1}` : ""}`];
    case "fourier":
      return [`.four ${toSpiceValue(analysis.fundamentalFrequency, "frequency")} ${analysis.outputs.join(" ")}`];
    case "custom":
      return analysis.commands.map(assertSafeDirective);
  }
}

export function assertSafeDirective(text: string): string {
  const directive = text.trim();
  if (!directive.startsWith(".")) throw new Error(`Custom ngspice directive must start with a period: ${text}`);
  if (/^\.(?:control|endc|shell|source|cd|quit|destroy|remcirc)\b/i.test(directive) || /[!`]/.test(directive)) {
    throw new Error(`Unsafe custom ngspice directive is not allowed: ${text}`);
  }
  return directive;
}

function normalizedNetlist(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trim()
    .concat("\n");
}

function saveExpressions(ir: CanonicalSimulationIr): string[] {
  const expressions = new Set<string>();
  for (const output of ir.outputs) {
    const value = output.expression.trim();
    if (value === "v(*)" || value === "all") expressions.add("all");
    else if (value) expressions.add(value);
  }
  if (expressions.size === 0) expressions.add("all");
  if (expressions.has("all")) return ["all"];
  return [...expressions];
}

function optionLines(ir: CanonicalSimulationIr): string[] {
  const profile = ir.environment.solverProfile;
  const values: Array<[string, number | string | boolean | undefined]> = [
    ["reltol", profile.reltol],
    ["abstol", profile.abstol],
    ["vntol", profile.vntol],
    ["gmin", profile.gmin],
    ["itl1", profile.itl1],
    ["itl4", profile.itl4],
    ["method", profile.method],
    ["maxord", profile.maxord],
  ];
  const tokens = values.filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${String(value)}`);
  const lines = tokens.length ? [`.options ${tokens.join(" ")}`] : [];
  for (const option of profile.customOptions ?? []) {
    const clean = option.trim().replace(/^\.options\s+/i, "");
    if (/^[A-Za-z0-9_.=+\-\s]+$/.test(clean)) lines.push(`.options ${clean}`);
  }
  return lines;
}

function analysisControlCommand(analysis: SimulationAnalysis): string {
  void analysis;
  // The analysis directive is already present in the deck. `run` executes it
  // with its full arguments; issuing bare `tran`/`ac` here would discard them.
  return "run";
}

export function compileNgspiceNetlist(
  ir: CanonicalSimulationIr,
  options: CompileNetlistOptions = {},
): NetlistBundle {
  const analysis = activeAnalysis(ir, options.analysisId);
  const writer = createWriter();
  writer.push(ir.title.replace(/[\r\n]+/g, " "));
  writer.push(`* Sirkit SPICE Studio IR v${ir.schemaVersion}`);
  writer.push(`* Design revision: ${ir.designRevisionId}`);
  writer.push(`* Test: ${ir.testRevision.id} r${ir.testRevision.revision}`);
  if (options.runPoint) writer.push(`* Run point: ${options.runPoint.label}`);
  writer.push("");

  const variableValues = { ...Object.fromEntries(ir.variables.map((variable) => [variable.name, variable.value])), ...(options.runPoint?.variableValues ?? {}) };
  for (const variable of ir.variables) {
    const value = variableValues[variable.name] ?? variable.value;
    writer.push(`.param ${safeParamName(variable.name)}=${toSpiceValue(value)}`, { kind: "variable", id: variable.id, label: variable.name });
  }
  for (const [name, value] of Object.entries(ir.environment.globalParameters)) {
    writer.push(`.param ${safeParamName(name)}=${toSpiceValue(value)}`, { kind: "variable", id: `global:${name}`, label: name });
  }
  writer.push(`.temp ${options.runPoint?.temperatureC ?? ir.environment.temperatureC}`);
  for (const line of optionLines(ir)) writer.push(line, { kind: "analysis", id: analysis.id, label: ir.environment.solverProfile.name });
  writer.push("");

  for (const model of ir.models) {
    const source: SourceRef = { kind: "model", id: model.id, label: `${model.name}@${model.version}` };
    const path = options.modelPaths?.[model.id];
    if (path) writer.push(`.include "${path.replace(/\\/g, "/")}"`, source);
    else if (modelText(model) && !modelText(model).startsWith("* native")) writer.push(modelText(model), source);
  }
  if (ir.models.length > 0) writer.push("");

  for (const device of ir.devices) writer.push(emitDevice(ir, device), device.source);
  writer.push("");
  for (const custom of ir.customDirectives) writer.push(assertSafeDirective(custom.text), custom.source);
  for (const directive of analysisDirective(analysis)) writer.push(directive, { kind: "analysis", id: analysis.id, label: analysis.name });
  writer.push(`.save ${saveExpressions(ir).join(" ")}`, { kind: "analysis", id: analysis.id, label: "saved outputs" });

  if (options.rawOutputPath) {
    const safePath = options.rawOutputPath.replace(/\\/g, "/").replace(/"/g, "");
    if (!/^[A-Za-z0-9._/-]+$/.test(safePath)) throw new Error("Raw output path must be a sandbox-relative safe path");
    writer.push(".control", { kind: "analysis", id: analysis.id, label: "execution control" });
    writer.push("set filetype=ascii", { kind: "analysis", id: analysis.id, label: "ASCII raw output" });
    writer.push(analysisControlCommand(analysis), { kind: "analysis", id: analysis.id, label: analysis.name });
    writer.push(`write ${safePath} ${saveExpressions(ir).join(" ")}`, { kind: "analysis", id: analysis.id, label: "result artifact" });
    writer.push("quit");
    writer.push(".endc");
  }
  writer.push(".end");

  const generated = writer.lines.join("\n").concat("\n");
  const normalized = normalizedNetlist(generated);
  // Model paths and selected run-point values are already resolved in this
  // compiler pass. Keeping a distinct field makes the provenance explicit and
  // leaves a seam for future dialect transforms or remote-worker packaging.
  const executed = normalized;
  return {
    generated,
    normalized,
    executed,
    sourceMap: writer.sourceMap,
    nodeMap: Object.fromEntries(ir.nodes.map((node) => [node.id, node.name])),
    pinNodes: options.pinNodes ?? {},
    warnings: [...ir.warnings],
  };
}

export function sourceForNetlistLine(bundle: NetlistBundle, line: number): SourceRef[] {
  return bundle.sourceMap
    .filter((entry) => line >= entry.lineStart && line <= entry.lineEnd)
    .map((entry) => entry.source);
}
