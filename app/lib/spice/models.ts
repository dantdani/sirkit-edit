import { createId, nowIso, stableHash } from "./identity";
import type {
  ModelAsset,
  ModelImportReport,
  ModelTransformPatch,
  ModelValidationCheck,
  SimulationAnalysis,
  SimulationPartSnapshot,
} from "./types";
import { emittedModelText, ngspiceCards, plainRelativeFileName, readsXspiceFileOutsideRunDirectory, SpiceDeckSafetyError } from "./netlist"; // [B22-A1] D22-4
const ALLOWED_EXTENSIONS = new Set(["lib", "cir", "sp", "spice", "mod", "model", "va", "vams"]);

export function isSupportedModelFile(fileName: string): boolean {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return ALLOWED_EXTENSIONS.has(extension);
}

export function detectSpiceDialect(content: string): string {
  const lower = content.toLowerCase();
  if (/simulator\s+lang\s*=\s*spectre|\bahdl_include\b/.test(lower)) return "spectre";
  if (/\.protect\b|\.lib\s+\S+\s+(?:tt|ff|ss)\b/.test(lower)) return "hspice-compatible";
  if (/\.func\b|\.param\b|\.subckt\b|\.model\b/.test(lower)) return "spice3/ngspice";
  if (/\bmodule\s+\w+\s*\(|`include\s+"disciplines\.vams"/.test(lower)) return "verilog-a";
  return "unknown-spice";
}

function cleanLines(content: string): string[] {
  return content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
}

function declarationLines(lines: string[]): Array<{ kind: "model" | "subckt"; name: string; pins: string[]; line: number }> {
  const declarations: Array<{ kind: "model" | "subckt"; name: string; pins: string[]; line: number }> = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const model = line.match(/^\.model\s+(\S+)\s+(\S+)/i);
    if (model) {
      declarations.push({ kind: "model", name: model[1], pins: [], line: index + 1 });
      continue;
    }
    const subckt = line.match(/^\.subckt\s+(\S+)\s*(.*)$/i);
    if (!subckt) continue;
    const tokens = subckt[2].trim().split(/\s+/).filter(Boolean);
    const pins = tokens.filter((token) => !token.includes("=") && !/^params?:/i.test(token));
    declarations.push({ kind: "subckt", name: subckt[1], pins, line: index + 1 });
  }
  return declarations;
}

function includeLines(lines: string[]): Array<{ path: string; line: number }> {
  const includes: Array<{ path: string; line: number }> = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].trim().match(/^\.(?:include|inc)\s+["']?([^"'\s]+)["']?/i);
    if (match) includes.push({ path: match[1], line: index + 1 });
  }
  return includes;
}

function unsupportedSyntax(lines: string[]): ModelImportReport["unsupported"] {
  const checks: Array<{ pattern: RegExp; syntax: string; message: string }> = [
    { pattern: /simulator\s+lang\s*=\s*spectre/i, syntax: "simulator lang=spectre", message: "Spectre language blocks require a reviewed compatibility transform." },
    { pattern: /\bahdl_include\b/i, syntax: "ahdl_include", message: "Compile Verilog-A to OSDI before ngspice execution." },
    { pattern: /^\s*section\s+\S+/i, syntax: "section", message: "Spectre library sections are not native ngspice syntax." },
    { pattern: /\blaplace_nd\s*\(/i, syntax: "laplace_nd", message: "This behavioral operator may require a B-source approximation." },
    { pattern: /^\s*\.protect\b/i, syntax: ".protect", message: "Encrypted/protected model blocks cannot be inspected or transformed." },
    { pattern: /\btable_model\s*\(/i, syntax: "table_model", message: "Vendor table models need dialect-specific validation." },
  ];
  const unsupported: ModelImportReport["unsupported"] = [];
  lines.forEach((line, index) => {
    for (const check of checks) {
      if (check.pattern.test(line)) unsupported.push({ syntax: check.syntax, line: index + 1, message: check.message });
    }
  });
  return unsupported;
}

function proposedTransforms(lines: string[], dialect: string): ModelTransformPatch[] {
  const patches: ModelTransformPatch[] = [];
  if (dialect === "spectre") {
    lines.forEach((line, index) => {
      if (/^\s*simulator\s+lang\s*=\s*spectre/i.test(line)) {
        patches.push({
          id: createId("modelpatch"),
          description: "Remove Spectre language switch when the remaining deck is SPICE-compatible.",
          original: line,
          replacement: `* SIRKIT PATCH (not yet approved): ${line}`,
          line: index + 1,
          approved: false,
        });
      }
    });
  }
  lines.forEach((line, index) => {
    if (/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(line)) {
      patches.push({
        id: createId("modelpatch"),
        description: "Normalize brace-delimited vendor parameters only after smoke-test review.",
        original: line,
        replacement: line.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$1"),
        line: index + 1,
        approved: false,
      });
    }
  });
  return patches;
}

export function importModelText(
  fileName: string,
  content: string,
  metadata: Partial<Pick<ModelAsset, "manufacturer" | "mpn" | "category" | "provenance" | "license" | "redistribution">> = {},
): ModelImportReport {
  if (!isSupportedModelFile(fileName)) throw new Error(`Unsupported model file extension: ${fileName}`);
  if (content.length === 0) throw new Error("Model file is empty");
  if (content.length > 5_000_000) throw new Error("Model file exceeds the 5 MB import limit");
  if (content.includes("\0")) throw new Error("Model file contains binary data or NUL bytes");
  const lines = cleanLines(content);
  const dialect = detectSpiceDialect(content);
  const declarations = declarationLines(lines);
  const includes = includeLines(lines);
  const unsupported = unsupportedSyntax(lines);
  const transforms = proposedTransforms(lines, dialect);
  const primary = declarations.find((declaration) => declaration.kind === "subckt") ?? declarations[0];
  const extension = fileName.toLowerCase().split(".").pop();
  const verilogA = extension === "va" || extension === "vams" || dialect === "verilog-a";
  const now = nowIso();
  const validationChecks: ModelValidationCheck[] = [
    {
      id: createId("modelcheck"),
      kind: "syntax",
      status: unsupported.length === 0 && declarations.length > 0 ? "pass" : unsupported.length > 0 ? "warning" : "fail",
      message: declarations.length === 0
        ? "No .model or .subckt declaration was found."
        : unsupported.length === 0
          ? `${declarations.length} declaration(s) parsed successfully.`
          : `${unsupported.length} dialect compatibility issue(s) require review.`,
      checkedAt: now,
    },
    { id: createId("modelcheck"), kind: "smoke", status: "pending", message: "Smoke test has not run." },
  ];
  const candidate: ModelAsset = {
    id: createId("model"),
    version: "1.0.0",
    name: primary?.name ?? fileName.replace(/\.[^.]+$/, ""),
    manufacturer: metadata.manufacturer,
    mpn: metadata.mpn,
    category: metadata.category ?? "unclassified",
    modelType: verilogA ? "verilog-a-osdi" : primary?.kind === "subckt" ? "subckt" : "model",
    sourceFileName: fileName,
    originalContent: content.replace(/^\uFEFF/, ""),
    checksum: stableHash(content),
    provenance: metadata.provenance ?? "user",
    license: metadata.license,
    redistribution: metadata.redistribution ?? "unknown",
    dialects: [dialect],
    subcircuitName: primary?.kind === "subckt" ? primary.name : undefined,
    externalPins: primary?.pins.map((pin, index) => ({ position: index + 1, name: pin })) ?? [],
    dependencies: includes.map((item) => item.path),
    defaultParameters: {},
    supportedAnalyses: ["op", "dc", "ac", "tran", "noise", "tf", "pz", "sens", "disto", "fourier", "custom"],
    unsupportedAnalyses: verilogA ? (["pz"] as SimulationAnalysis["type"][]) : [],
    validationStatus: unsupported.length === 0 && declarations.length > 0 ? "syntax-checked" : "unverified",
    validationChecks,
    warnings: [
      ...unsupported.map((item) => `Line ${item.line}: ${item.message}`),
      ...(includes.length > 0 ? [`Requires ${includes.length} include dependency file(s).`] : []),
      ...(transforms.length > 0 ? [`${transforms.length} reversible compatibility patch(es) proposed; none applied.`] : []),
    ],
    transforms,
    createdAt: now,
    updatedAt: now,
  };
  return {
    fileName,
    encoding: "UTF-8",
    dialect,
    declarations,
    includes,
    unsupported,
    warnings: candidate.warnings,
    candidate,
  };
}

export function applyApprovedModelTransforms(model: ModelAsset): ModelAsset {
  let transformed = model.originalContent;
  const approved = model.transforms.filter((patch) => patch.approved);
  for (const patch of approved) {
    const index = transformed.indexOf(patch.original);
    if (index < 0) throw new Error(`Model patch source was not found: ${patch.description}`);
    transformed = `${transformed.slice(0, index)}${patch.replacement}${transformed.slice(index + patch.original.length)}`;
  }
  return { ...model, transformedContent: approved.length > 0 ? transformed : undefined, updatedAt: nowIso() };
}

export function assertModelSafeForExecution(model: ModelAsset): void {
  const content = emittedModelText(model); // [B22-A1] D22-4: exactly the text the deck emits (netlist.ts), never `transformedContent ?? originalContent`
  const forbidden = [
    { pattern: /^\s*simulator\s+lang\s*=\s*spectre\b/im, label: "untransformed Spectre language blocks" },
    { pattern: /^\s*\.control\b/im, label: ".control blocks" },
    { pattern: /^\s*\.(?:shell|cd|source|quit)\b/im, label: "filesystem or shell commands" },
    { pattern: /(?:^|\s)![^=]/m, label: "shell escapes" },
    { pattern: /`[^`]+`/, label: "command substitution" },
    { pattern: /^\s*\.(?:include|inc)\s+["']?(?:[A-Za-z]:[\\/]|[/\\]{2}|\/)/im, label: "absolute include paths" },
  ];
  const hit = forbidden.find((entry) => entry.pattern.test(content));
  if (hit) throw hidesOriginal(model) ? new SpiceDeckSafetyError(`a blank transformedContent may not hide model text that carries forbidden ${hit.label}`) : new Error(`${model.name} contains forbidden ${hit.label}`); // [B22-A1 review] regressions-1: closed when a blank transformedContent hides the original (SEC-1's final screen refused that text, 422 before any job); the screen's own message otherwise, as before
  assertModelFileReadsSafe(content); // [B22-A1] D22-4: the closed refusal of a file read outside the run directory
  const dependencies = modelIncludeDependencies(content); // [B22-A1] D22-4: recomputed from the screened text, never the client's `model.dependencies`
  if (dependencies.length > 0) {
    throw new SpiceDeckSafetyError(`model text has ${dependencies.length} unresolved include dependency file(s); package them before execution`); // [B22-A1 review] regressions-1, coverage-3: closed - the deck would read the file, and SEC-1's final screen refused the include closed, 422 before any job
  }
}

export function inferPinMap(
  part: SimulationPartSnapshot,
  model: ModelAsset,
): { pinMap: Record<string, string>; confidence: number; warnings: string[] } {
  const pinMap: Record<string, string> = {};
  const warnings: string[] = [];
  let score = 0;
  for (const external of model.externalPins) {
    const normalized = external.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const exact = part.pins.find((pin) => [pin.number, pin.name].some((value) => value.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized));
    const positional = part.pins[external.position - 1];
    const matched = exact ?? positional;
    if (!matched) {
      warnings.push(`Model pin ${external.position} (${external.name}) has no symbol candidate.`);
      continue;
    }
    pinMap[matched.number || matched.name] = external.name;
    score += exact ? 1 : 0.55;
    if (!exact) warnings.push(`Mapped model pin ${external.name} to symbol pin ${matched.number} by position; review required.`);
  }
  const denominator = Math.max(1, model.externalPins.length);
  return { pinMap, confidence: score / denominator, warnings };
}

export function searchModels(
  models: ModelAsset[],
  query: string,
  constraints: { category?: string; manufacturer?: string; analyses?: SimulationAnalysis["type"][]; trustedOnly?: boolean } = {},
): ModelAsset[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const validationRank: Record<ModelAsset["validationStatus"], number> = {
    trusted: 5,
    "curve-validated": 4,
    "smoke-tested": 3,
    "syntax-checked": 2,
    unverified: 1,
  };
  const provenanceRank: Record<ModelAsset["provenance"], number> = {
    vendor: 6,
    distributor: 5,
    "open-library": 4,
    "built-in": 4,
    user: 3,
    "ai-approximation": 1,
  };
  return models
    .filter((model) => !constraints.category || model.category.toLowerCase() === constraints.category.toLowerCase())
    .filter((model) => !constraints.manufacturer || model.manufacturer?.toLowerCase().includes(constraints.manufacturer.toLowerCase()))
    .filter((model) => !constraints.trustedOnly || ["trusted", "curve-validated"].includes(model.validationStatus))
    .filter((model) => (constraints.analyses ?? []).every((analysis) => model.supportedAnalyses.includes(analysis)))
    .map((model) => {
      const haystack = [model.name, model.manufacturer, model.mpn, model.category, model.subcircuitName].filter(Boolean).join(" ").toLowerCase();
      const matches = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 10 : 0), 0);
      return { model, score: matches + validationRank[model.validationStatus] * 2 + provenanceRank[model.provenance] };
    })
    .filter((entry) => tokens.length === 0 || entry.score >= 10)
    .sort((a, b) => b.score - a.score || a.model.name.localeCompare(b.model.name))
    .map((entry) => entry.model);
}

// ─── [B22-A1] model text that reads a file (closes the rest of D22-4) ─────────────────────────────────────────────────────

/** [B22-A1] Model text's lines as the deck and ngspice may break them - LF, CRLF, a lone CR and a form feed (the final deck
 *  screen reads a form feed as a line break too) - so no reading hides a directive. */
const modelLines = (content: string): string[] => content.split(/\r\n|\r|\n|\f/);

/** [B22-A1] An `.include`/`.inc` line: ngspice reads any line starting `.inc` as one (INFERRED from its front end; the final
 *  deck screen reads it so too, netlist.ts assertDeckLineSafe). Its path is the next token, quotes removed. */
const INCLUDE_LINE = /^\s*\.inc\S*(?:\s+(.*))?$/i;
function includePath(rest: string | undefined): string {
  const text = (rest ?? "").trim();
  const quoted = /^(["'])(.*?)\1/.exec(text);
  return quoted ? quoted[2]! : (text.split(/\s+/)[0] ?? "");
}

/** [B22-A1] The include dependencies of the screened text - never the client's `model.dependencies`. */
function modelIncludeDependencies(content: string): string[] {
  return modelLines(content).flatMap((line) => {
    const include = INCLUDE_LINE.exec(line);
    return include ? [includePath(include[1])] : [];
  });
}

/**
 * [B22-A1] D22-4: the model screen's closed refusal (it names the rule, never the text) of model text that reads a file outside
 * the run's fresh directory - every `.lib` line (a library read with any path, and a one-token `.lib` line: fail-closed, since
 * whether ngspice-46 reads its token as a file is UNKNOWN and no executed deck has accepted a `.lib` line since SEC-1), an
 * `.include`/`.inc` whose path is not a plain relative file name, and - read over the cards as ngspice joins them, [B22-A1
 * review] - an XSPICE file parameter whose value is not one or a code model that starts a program or loads a library; and text
 * that opens with a `+` line, which the deck would join to the card the model before it ended with. An include is a dependency.
 */
function assertModelFileReadsSafe(content: string): void {
  for (const line of modelLines(content)) {
    if (/^\s*\.lib/i.test(line)) throw new SpiceDeckSafetyError("model text may not read a library (.lib)");
    const include = INCLUDE_LINE.exec(line);
    if (include && !plainRelativeFileName(includePath(include[1]))) throw new SpiceDeckSafetyError("model text may include only a plain relative file name inside the run directory");
  }
  if (ngspiceCards(content).some((card) => card.startsWith("+"))) throw new SpiceDeckSafetyError("model text may not open with a '+' continuation line: the deck would join it to the card before it"); // [B22-A1 review] coverage-2
  if (readsXspiceFileOutsideRunDirectory(content)) { // [B22-A1 review] tests-1, coverage-1: over the cards as ngspice joins them, every code model enumerated (netlist.ts)
    throw new SpiceDeckSafetyError("an XSPICE parameter in model text may name only a plain relative file inside the run directory, and no code model may start a program or load a library");
  }
}

/** [B22-A1 review] regressions-1: a blank `transformedContent`, which the deck passes over to emit the original - where the
 *  screen's reading before B22-A1 (`transformedContent ?? originalContent`) saw no text at all. */
function hidesOriginal(model: ModelAsset): boolean {
  return typeof model.transformedContent === "string" && model.transformedContent.trim() === "";
}
