import { createId, nowIso, stableHash } from "./identity";
import type {
  ModelAsset,
  ModelImportReport,
  ModelTransformPatch,
  ModelValidationCheck,
  SimulationAnalysis,
  SimulationPartSnapshot,
} from "./types";

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
  const content = model.transformedContent ?? model.originalContent;
  const forbidden = [
    { pattern: /^\s*simulator\s+lang\s*=\s*spectre\b/im, label: "untransformed Spectre language blocks" },
    { pattern: /^\s*\.control\b/im, label: ".control blocks" },
    { pattern: /^\s*\.(?:shell|cd|source|quit)\b/im, label: "filesystem or shell commands" },
    { pattern: /(?:^|\s)![^=]/m, label: "shell escapes" },
    { pattern: /`[^`]+`/, label: "command substitution" },
    { pattern: /^\s*\.(?:include|inc)\s+["']?(?:[A-Za-z]:[\\/]|[/\\]{2}|\/)/im, label: "absolute include paths" },
  ];
  const hit = forbidden.find((entry) => entry.pattern.test(content));
  if (hit) throw new Error(`${model.name} contains forbidden ${hit.label}`);
  if (model.dependencies.length > 0) {
    throw new Error(`${model.name} has ${model.dependencies.length} unresolved include dependency file(s); package them before execution`);
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
