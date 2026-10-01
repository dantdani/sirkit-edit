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
      const block = Array.isArray(text) ? text : [assertDeckText(text, "a deck line")]; // [SEC-1] one line per push, never split
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
  const directive = assertDeckText(text, "a custom directive").trim(); // [SEC-1] one line, screened before the trim
  if (!directive.startsWith(".")) throw new Error(`Custom ngspice directive must start with a period: ${text}`);
  if (/^\.(?:control|endc|shell|source|cd|quit|destroy|remcirc)\b/i.test(directive) || /[!`]/.test(directive)) {
    throw new SpiceDeckSafetyError("Unsafe custom ngspice directive is not allowed"); // [SEC-1] closed: never echoes the text
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
    if (/^[A-Za-z0-9_.=+\-\t ]+$/.test(clean)) lines.push(`.options ${clean}`); // [SEC-1] space/tab only, never a line break
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
  const analysis = assertDeckInputsSafe(ir, options, activeAnalysis(ir, options.analysisId)); // [SEC-1] the field screen
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
    else if (modelText(model) && !modelText(model).startsWith("* native")) writer.push(modelText(model).split(/\r?\n/), source); // [SEC-1] multi-line by nature: the final screen holds it
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

  const generated = assertCompiledDeckSafe(writer.lines.join("\n").concat("\n"), compiledDeckExpectation(ir, options)); // [SEC-1]
  const normalized = normalizedNetlist(generated);
  // Model paths and selected run-point values are already resolved in this
  // compiler pass. Keeping a distinct field makes the provenance explicit and
  // leaves a seam for future dialect transforms or remote-worker packaging.
  const executed = assertCompiledDeckSafe(normalized, compiledDeckExpectation(ir, options)); // [SEC-1] the final deck screen
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

// ─── [SEC-1] deck safety (closes D22-3) ──────────────────────────────────────────────────────────────────────────────

/**
 * [SEC-1] The closed refusal of a deck that could carry caller or model text as a live ngspice line. It names the field or
 * the rule, never the refused text: a run error reaches the run record and, through the SPICE AI evidence, a model.
 */
export class SpiceDeckSafetyError extends Error {
  readonly code = "SPICE_DECK_UNSAFE";
  constructor(detail: string) {
    super(`SPICE_DECK_UNSAFE: ${detail}`);
    this.name = "SpiceDeckSafetyError";
  }
}

/** [SEC-1] /api/simulate's `unsafe()` rule (B19-D: a C0 control, DEL or a backtick) extended to every line-break form: a C1
 *  control (U+0085 NEL among them), U+2028 and U+2029. [SEC-1 review] Except a TAB: SPICE whitespace, a token separator that
 *  never opens a line, valid in these fields on main (a tab-separated `.param` pasted into the directives box); the `write`
 *  line's output-expression allowlist still refuses it. */
function unsafeDeckCharacter(code: number): boolean {
  return (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0x60;
}

/**
 * [SEC-1] The ONE single-line screen for a caller or model string written into a deck (the smoke test uses it too): refused
 * raw, before any trim or unit parsing, and never stripped into a different deck.
 */
export function assertDeckText(value: unknown, field: string): string {
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    if (unsafeDeckCharacter(text.charCodeAt(index))) throw new SpiceDeckSafetyError(`${field} must be one line without control characters or backticks`);
  }
  return text;
}

/**
 * [SEC-1] An output expression is also written INSIDE the compiler's own `.control` block (the `write` line), where ngspice's
 * command language reads `;` as a command separator, `<` and `>` as redirection and `$`, `!`, `{` and `~` as substitutions
 * (INFERRED from the ngspice front end, never executed here). Only vector names, functions and arithmetic pass.
 */
const OUTPUT_EXPRESSION = /^[A-Za-z0-9_.,:#@()[\]+*/ -]*$/;
function assertOutputExpression(value: unknown): void {
  if (!OUTPUT_EXPRESSION.test(assertDeckText(value, "an output expression"))) {
    throw new SpiceDeckSafetyError("an output expression may hold only vector names, functions and arithmetic");
  }
}

/** [SEC-1] Every string of the active analysis, at any depth, as the analysis directive writes them. */
function assertAnalysisText(value: unknown): void {
  if (Array.isArray(value)) for (const item of value) assertAnalysisText(item);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) assertAnalysisText(item);
  else assertDeckText(value, "an analysis field");
}

/**
 * [SEC-1 review] What differs between the run points of one test and analysis: the label, the variable values and the
 * temperature. The run-plan preflight screens these per point and compiles one deck per test and analysis.
 */
export function assertRunPointSafe(point: RunPoint): void {
  assertDeckText(point.label, "the run point label");
  assertDeckText(point.temperatureC, "the run point temperature");
  for (const value of Object.values(point.variableValues ?? {})) assertDeckText(value, "a run point variable value");
}

/**
 * [SEC-1] Every caller or model string `compileNgspiceNetlist` writes, screened raw at the IR -> deck boundary (enumerated
 * from its writer calls). Element and node names reach the IR already reduced to identifier characters by the IR compiler;
 * [SEC-1 review] the raw names they were reduced from (references, net labels, overlay names and target nets, kept in the
 * IR's source references and aliases) are screened too, so a refused character is refused, never sanitized into a different
 * deck. Model text is multi-line by nature and is held by the final deck screen.
 */
function assertDeckInputsSafe(ir: CanonicalSimulationIr, options: CompileNetlistOptions, analysis: SimulationAnalysis): SimulationAnalysis {
  assertDeckText(ir.title, "the project or test name");
  assertDeckText(ir.schemaVersion, "the IR schema version");
  assertDeckText(ir.designRevisionId, "the design revision id");
  assertDeckText(ir.testRevision.id, "the test id");
  assertDeckText(ir.testRevision.revision, "the test revision");
  if (options.runPoint) assertRunPointSafe(options.runPoint);
  for (const variable of ir.variables) {
    assertDeckText(variable.name, "a design variable name");
    assertDeckText(variable.value, "a design variable value");
  }
  for (const [name, value] of Object.entries(ir.environment.globalParameters)) {
    assertDeckText(name, "a global parameter name");
    assertDeckText(value, "a global parameter value");
  }
  assertDeckText(ir.environment.temperatureC, "the temperature");
  const profile = ir.environment.solverProfile;
  for (const key of ["reltol", "abstol", "vntol", "gmin", "itl1", "itl4", "method", "maxord"] as const) {
    if (profile[key] !== undefined) assertDeckText(profile[key], "a solver option");
  }
  for (const option of profile.customOptions ?? []) assertDeckText(option, "a custom .options entry");
  for (const path of Object.values(options.modelPaths ?? {})) assertDeckText(path, "a model path");
  for (const node of ir.nodes) {
    assertDeckText(node.name, "a node name");
    for (const alias of node.aliases ?? []) assertDeckText(alias, "a net name");
    for (const ref of node.sourceRefs ?? []) if (ref.label !== undefined) assertDeckText(ref.label, "a net name");
  }
  for (const device of ir.devices) {
    assertDeckText(device.name, "an element name");
    if (device.source?.label !== undefined) assertDeckText(device.source.label, "an element reference or name");
    if (device.value !== undefined) assertDeckText(device.value, "an element or source value");
    if (device.modelName !== undefined) assertDeckText(device.modelName, "a model or subcircuit name");
    for (const [name, value] of Object.entries(device.parameters)) {
      assertDeckText(name, "a model parameter name");
      assertDeckText(value, "a model parameter value");
    }
  }
  for (const directive of ir.customDirectives) assertDeckText(directive.text, "a custom directive");
  assertAnalysisText(analysis);
  for (const output of ir.outputs) assertOutputExpression(output.expression);
  return analysis;
}

/** [SEC-1] What a compiled deck may hold: the compiler's own batch control block when it is executed, none otherwise (the
 *  compile preview, the smoke test); an EXECUTED deck reads no file through `.include`/`.lib` but the includes the compiler
 *  wrote itself. [SEC-1 review] `cards` are the element lines the compiler wrote: a C, L, D or Q element may be named like
 *  a command word (a capacitor CD, an inductor LOAD), and only those exact lines pass the command-word rule. */
export interface DeckExpectation {
  controlBlock: boolean;
  executed: boolean;
  includes?: readonly string[];
  cards?: readonly string[];
}

/** [SEC-1] The expectation for a deck the compiler writes from `ir` with `options` (the worker screens its deck with it too). */
export function compiledDeckExpectation(ir: CanonicalSimulationIr, options: CompileNetlistOptions): DeckExpectation {
  const executed = Boolean(options.rawOutputPath);
  return {
    controlBlock: executed,
    executed,
    includes: Object.values(options.modelPaths ?? {}).map((path) => `.include "${path.replace(/\\/g, "/")}"`),
    cards: ir.devices.map((device) => emitDevice(ir, device)),
  };
}

/** The compiler's own batch block, line for line (`write` carries the server-owned raw path and screened output expressions). */
const OWN_CONTROL_BLOCK: ReadonlyArray<string | RegExp> = [".control", "set filetype=ascii", "run", /^write [A-Za-z0-9._/-]+ [A-Za-z0-9_.,:#@()[\]+*/ -]+$/, "quit", ".endc"];
/** [SEC-1 review] Every command word the SEC-1 task names; no line from caller or model data starts with one (the compiler's
 *  own element cards excepted, see `DeckExpectation.cards`). */
const COMMAND_LINE = /^\s*(?:shell|source|cd|load|write|quit|set|unset|alias|define|codemodel|setcs|unsetcs)(?:\s|$)/i;
/** [SEC-1 review] A vendor banner: a `*#` line whose rest is only `#`, `-`, `=` and whitespace names no command (INFERRED: ngspice
 *  reads the rest as a command line; a `*` is not admitted, the command language expands it as a file pattern). */
const BANNER_LINE = /^\s*\*#[#=\s-]*$/;

/** [SEC-1] The rules every deck line obeys outside the compiler's own block (the title excepted, see below). */
function assertDeckLineSafe(text: string, expected: DeckExpectation, includes: ReadonlySet<string>, cards: ReadonlySet<string>): void {
  if (/^\s*\.title\b\s*\*\s*ng_script/i.test(text)) throw new SpiceDeckSafetyError("the deck would run as an ngspice script");
  if (/^\s*\*#/.test(text) && !BANNER_LINE.test(text)) throw new SpiceDeckSafetyError("the deck carries a '*#' command line");
  if (/^\s*\.(?:shell|cd|source|quit|exec|system|destroy|remcirc)\b/i.test(text)) throw new SpiceDeckSafetyError("the deck carries a filesystem or shell directive");
  if (COMMAND_LINE.test(text) && !cards.has(text.trimEnd())) throw new SpiceDeckSafetyError("the deck carries an ngspice command outside the compiler's control block");
  if (/^\s*![^=]/.test(text)) throw new SpiceDeckSafetyError("the deck carries a shell escape");
  if (expected.executed && /^\s*\.(?:inc|lib)/i.test(text) && !includes.has(text)) throw new SpiceDeckSafetyError("the deck reads a file the compiler did not include");
}

/**
 * [SEC-1] The FINAL deck screen: run on every compiled deck (generated and executed), by the worker before `executed.cir` is
 * written and by the smoke test before its deck is written. The deck breaks lines only with LF and carries no NUL; it holds
 * exactly the compiler's own `.control` block when executed and none otherwise, so no other line is read as a command
 * (`.control` and `.endc` are matched by prefix, as ngspice matches them); it carries no `*#` command line (ngspice runs one
 * as a control command; a vendor banner passes), no script title, no shell or filesystem directive, no command line outside
 * the block, no shell escape and no command substitution; and an executed deck reads no file through `.include`/`.lib` but
 * the compiler's own includes. [SEC-1 review] The first line is the title, which ngspice reads as text, never as a card: only
 * a `*ng_script` title is refused there (a script deck runs every line). A form feed (a legacy page break in model text) is
 * whitespace to SPICE; it is also read as a line break here, so every rule holds for each form-feed piece of a line as well.
 */
export function assertCompiledDeckSafe(deck: string, expected: DeckExpectation): string {
  for (let index = 0; index < deck.length; index += 1) {
    const code = deck.charCodeAt(index);
    if (code === 0 || code === 0x0b || code === 0x0d || code === 0x85 || code === 0x2028 || code === 0x2029) {
      throw new SpiceDeckSafetyError("the deck may break lines only with LF and may not carry NUL");
    }
  }
  if (/`[^`]+`/.test(deck)) throw new SpiceDeckSafetyError("the deck carries command substitution");
  const lines = deck.split("\n");
  if (/^\s*\*\s*ng_script/i.test(lines[0] ?? "")) throw new SpiceDeckSafetyError("the deck would run as an ngspice script");
  const controls = lines.flatMap((line, index) => (index > 0 && /^\s*\.control/i.test(line) ? [index] : []));
  const ends = lines.flatMap((line, index) => (index > 0 && /^\s*\.endc/i.test(line) ? [index] : []));
  const start = expected.controlBlock && controls.length === 1 ? controls[0]! : -1;
  const own = start >= 0 && ends.length === 1 && ends[0] === start + OWN_CONTROL_BLOCK.length - 1
    && OWN_CONTROL_BLOCK.every((rule, offset) => (typeof rule === "string" ? lines[start + offset] === rule : rule.test(lines[start + offset] ?? "")));
  if (expected.controlBlock ? !own : controls.length > 0 || ends.length > 0) throw new SpiceDeckSafetyError("the deck carries a control block the compiler did not write");
  const includes = new Set(expected.includes ?? []);
  const cards = new Set((expected.cards ?? []).map((card) => card.trimEnd()));
  lines.forEach((line, index) => {
    if (own && index >= start && index < start + OWN_CONTROL_BLOCK.length) return;
    const pieces = line.includes("\f") ? line.split("\f").slice(index === 0 ? 1 : 0) : [];
    for (const piece of pieces) {
      if (/^\s*\.(?:control|endc)/i.test(piece)) throw new SpiceDeckSafetyError("the deck carries a control block the compiler did not write");
      assertDeckLineSafe(piece, expected, includes, cards);
    }
    if (index > 0) assertDeckLineSafe(line, expected, includes, cards);
  });
  return deck;
}

/** [SEC-1 review] Test seams: the writer and the `.options` screen, each pinned on its own behind the field screen. */
export const __deckLayersForTests = { createWriter, optionLines };
