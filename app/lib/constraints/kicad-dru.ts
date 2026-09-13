import { findChild, getNumber, getString, head, isList, parseSExpForms, type SExpr } from "@/app/lib/kicad/sexp";
import type {
  ConstraintDefinition,
  ConstraintDocument,
  ConstraintKind,
  ConstraintProgram,
  ConstraintQuantity,
  ConstraintStrength,
  TypedRequirement,
  TypedSelector,
} from "./types";
import { constraintSemanticHash, stableConstraintId } from "./stable";
import { quantityToInteger } from "./quantity";

export const KICAD_CONSTRAINT_TARGET_VERSION = "10.0" as const;

export interface ConstraintAdapterLoss {
  sourceId: string;
  constraintIds: string[];
  disposition: "exact" | "transformed" | "approximated" | "omitted" | "unsupported";
  severity: "info" | "warning" | "error";
  message: string;
}

export interface KicadDruImportResult {
  ok: boolean;
  quarantined: boolean;
  document?: ConstraintDocument;
  losses: ConstraintAdapterLoss[];
  diagnostics: string[];
}

export interface KicadDruExportResult {
  targetVersion: typeof KICAD_CONSTRAINT_TARGET_VERSION;
  text: string;
  verified: boolean;
  losses: ConstraintAdapterLoss[];
}

function stripComments(text: string): string {
  let output = "";
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      output += char;
      escaped = false;
    } else if (char === "\\" && quoted) {
      output += char;
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
      output += char;
    } else if (char === "#" && !quoted) {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
    } else output += char;
  }
  return output;
}

function countTree(node: SExpr, depth = 0): { nodes: number; depth: number } {
  if (!isList(node)) return { nodes: 1, depth };
  let nodes = 1;
  let maxDepth = depth;
  for (const child of node) {
    const counted = countTree(child, depth + 1);
    nodes += counted.nodes;
    maxDepth = Math.max(maxDepth, counted.depth);
  }
  return { nodes, depth: maxDepth };
}

function parseQuantity(node: SExpr | undefined): ConstraintQuantity | null {
  if (node === undefined) return null;
  const text = typeof node === "number" ? `${node}mm` : typeof node === "string" ? node : "";
  const match = /^([-+]?(?:0|[1-9]\d*)(?:\.\d+)?)(mm|um|nm)$/.exec(text);
  if (!match) return null;
  return { dimension: "length", value: match[1], unit: match[2] };
}

function conditionSelector(condition: string | null, netNameToStableIds: Record<string, string[]>): { selector?: TypedSelector; loss?: string } {
  if (!condition) return { selector: { objectType: "net", predicate: { kind: "all" }, cardinality: { kind: "zero_or_more" } } };
  const exactNet = /^\s*A\.NetName\s*==\s*'([^']+)'\s*$/.exec(condition);
  if (exactNet) {
    const ids = [...new Set(netNameToStableIds[exactNet[1]] ?? [])].sort();
    if (ids.length !== 1) return { loss: `Condition '${condition}' resolves ${ids.length} stable nets; exactly one is required.` };
    return { selector: { objectType: "net", predicate: { kind: "ids", ids }, cardinality: { kind: "exactly", count: 1 } } };
  }
  const netClass = /^\s*A\.hasNetclass\('([^']+)'\)\s*$/.exec(condition);
  if (netClass) return { selector: { objectType: "net", predicate: { kind: "attribute", field: "classId", operator: "eq", value: netClass[1] }, cardinality: { kind: "zero_or_more" } } };
  return { loss: `Condition '${condition}' is outside the bounded KiCad import subset.` };
}

const KICAD_KIND: Record<string, ConstraintKind | undefined> = {
  track_width: "trace_width",
  clearance: "clearance",
  via_diameter: "via_diameter",
  hole_size: "via_drill",
  annular_width: "annular_ring",
  edge_clearance: "edge_clearance",
  length: "route_length",
  skew: "pair_skew",
  via_count: "via_count",
};

function requirementFromConstraint(node: SExpr[], kind: ConstraintKind): TypedRequirement | null {
  if (kind === "via_count") {
    const maximum = getNumber(findChild(node, "max")?.[1]);
    return maximum !== null && Number.isSafeInteger(maximum) && maximum >= 0
      ? { form: "maximum", value: { dimension: "dimensionless", value: String(maximum), unit: "1" } }
      : null;
  }
  const minimum = parseQuantity(findChild(node, "min")?.[1]);
  const maximum = parseQuantity(findChild(node, "max")?.[1]);
  if (minimum && maximum) return { form: "range", min: minimum, max: maximum, minInclusive: true, maxInclusive: true };
  if (minimum) return { form: "minimum", value: minimum };
  if (maximum) return { form: "maximum", value: maximum };
  return null;
}

export function importKicadDru(input: {
  text: string;
  sourceId: string;
  sourceRevision: string;
  netNameToStableIds: Record<string, string[]>;
}): KicadDruImportResult {
  if (new TextEncoder().encode(input.text).byteLength > 500_000) return { ok: false, quarantined: true, losses: [], diagnostics: ["KiCad rule file exceeds 500000 bytes."] };
  let root: SExpr;
  try {
    // [B19-D I5d row 46] the file is a sequence of forms. Wrapping it in a synthetic root let a stray ')' close that root
    // early and silently drop every rule after it; a bounded depth refuses hostile nesting before the tree is walked.
    root = ["sirkit_dru_root", ...parseSExpForms(stripComments(input.text), { maxDepth: 40 })];
  } catch (error) {
    return { ok: false, quarantined: true, losses: [], diagnostics: [error instanceof Error ? error.message : "Invalid KiCad S-expression."] };
  }
  const counted = countTree(root);
  if (counted.depth > 40 || counted.nodes > 50_000) return { ok: false, quarantined: true, losses: [], diagnostics: ["KiCad rule file exceeds parser depth/node limits."] };
  if (!isList(root)) return { ok: false, quarantined: true, losses: [], diagnostics: ["KiCad rule root is invalid."] };
  const version = root.find((node) => isList(node) && head(node) === "version");
  if (!version || !isList(version) || getNumber(version[1]) !== 1) return { ok: false, quarantined: true, losses: [], diagnostics: ["Only KiCad .kicad_dru schema version 1 is supported."] };
  const losses: ConstraintAdapterLoss[] = [];
  const constraints: ConstraintDefinition[] = [];
  const fileHash = constraintSemanticHash({ sourceId: input.sourceId, text: input.text });
  const rules = root.filter((node): node is SExpr[] => isList(node) && head(node) === "rule");
  for (const [ruleIndex, ruleNode] of rules.entries()) {
    const ruleName = getString(ruleNode[1]) ?? `rule-${ruleIndex + 1}`;
    const condition = getString(findChild(ruleNode, "condition")?.[1]);
    const severity = getString(findChild(ruleNode, "severity")?.[1]);
    const resolved = conditionSelector(condition, input.netNameToStableIds);
    const sourceRuleId = `${input.sourceId}:${ruleName}`;
    if (!resolved.selector) {
      losses.push({ sourceId: sourceRuleId, constraintIds: [], disposition: "unsupported", severity: "error", message: resolved.loss ?? "Unsupported KiCad condition." });
      continue;
    }
    if (severity === "ignore" || severity === "exclusion") {
      losses.push({ sourceId: sourceRuleId, constraintIds: [], disposition: "unsupported", severity: "warning", message: `KiCad severity '${severity}' has order-dependent override semantics and was not activated.` });
      continue;
    }
    const constraintNodes = ruleNode.filter((node): node is SExpr[] => isList(node) && head(node) === "constraint");
    for (const [constraintIndex, constraintNode] of constraintNodes.entries()) {
      const externalKind = getString(constraintNode[1]);
      const kind = externalKind && Object.hasOwn(KICAD_KIND, externalKind) ? KICAD_KIND[externalKind] : undefined; // [B19-D I5c row 18]
      const requirement = kind ? requirementFromConstraint(constraintNode, kind) : null;
      const id = stableConstraintId("kicad-rule", { fileHash, ruleName, constraintIndex, externalKind });
      if (!kind || !requirement) {
        losses.push({ sourceId: sourceRuleId, constraintIds: [id], disposition: "unsupported", severity: "error", message: `KiCad constraint '${externalKind ?? "unknown"}' or its value form is outside the supported subset.` });
        continue;
      }
      constraints.push({
        id,
        revision: 1,
        name: ruleName,
        domain: kind === "trace_width" || kind === "route_length" || kind === "pair_skew" || kind === "via_count" ? "routing" : "pcb_geometry",
        kind,
        scope: { type: "project" },
        selector: resolved.selector,
        requirement,
        strength: "hard",
        severityPolicyId: severity === "warning" ? "severity:warning" : "severity:blocking",
        origin: { kind: "kicad_import", sourceId: input.sourceId, sourceRevision: input.sourceRevision },
        evidenceIds: [],
        lifecycle: { state: "active" },
        waiverPolicy: { eligible: false },
        sourceLocation: { sourceId: input.sourceId, path: `rule:${ruleName}:constraint:${constraintIndex}` },
      });
      losses.push({ sourceId: sourceRuleId, constraintIds: [id], disposition: "transformed", severity: "info", message: "Imported into order-independent restrictive algebra; stable targets replace the external name condition." });
    }
  }
  const document: ConstraintDocument = {
    schemaVersion: 1,
    id: stableConstraintId("constraint-set-kicad", { sourceId: input.sourceId, sourceRevision: input.sourceRevision }),
    revision: 1,
    name: `KiCad 10 rules: ${input.sourceId}`,
    description: "Bounded .kicad_dru subset. Unsupported expressions are retained in the loss report, never silently applied.",
    extendsSetIds: [],
    constraints: constraints.sort((a, b) => a.id.localeCompare(b.id)),
    relationships: [],
  };
  return { ok: true, quarantined: false, document, losses: losses.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.message.localeCompare(b.message)), diagnostics: [] };
}

export interface KicadNetClassInput {
  id: string;
  name: string;
  netStableIds: string[];
  clearanceMm?: number;
  trackWidthMm?: number;
  viaDiameterMm?: number;
  viaDrillMm?: number;
}

export function importKicadNetClasses(input: { sourceId: string; sourceRevision: string; classes: KicadNetClassInput[] }): { document: ConstraintDocument; losses: ConstraintAdapterLoss[] } {
  const constraints: ConstraintDefinition[] = [];
  const losses: ConstraintAdapterLoss[] = [];
  for (const netClass of [...input.classes].sort((a, b) => a.id.localeCompare(b.id))) {
    const selector: TypedSelector = { objectType: "net", predicate: { kind: "ids", ids: [...new Set(netClass.netStableIds)].sort() }, cardinality: { kind: "exactly", count: new Set(netClass.netStableIds).size } };
    const values: Array<{ kind: ConstraintKind; value: number | undefined; strength: ConstraintStrength; label: string }> = [
      { kind: "clearance", value: netClass.clearanceMm, strength: "hard", label: "clearance" },
      { kind: "trace_width", value: netClass.trackWidthMm, strength: "soft", label: "preferred track width" },
      { kind: "via_diameter", value: netClass.viaDiameterMm, strength: "soft", label: "preferred via diameter" },
      { kind: "via_drill", value: netClass.viaDrillMm, strength: "soft", label: "preferred via drill" },
    ];
    for (const value of values) {
      if (value.value === undefined) continue;
      const id = stableConstraintId("kicad-netclass-rule", { sourceId: input.sourceId, classId: netClass.id, kind: value.kind });
      constraints.push({ id, revision: 1, name: `${netClass.name} ${value.label}`, domain: value.kind === "clearance" ? "pcb_geometry" : "routing", kind: value.kind, scope: { type: "net_class", id: `net-class:${netClass.id}` }, selector, requirement: value.strength === "soft" ? { form: "objective", direction: "minimize", metric: `${value.kind}:${value.value}mm`, weight: "1" } : { form: "minimum", value: { dimension: "length", value: String(value.value), unit: "mm" } }, strength: value.strength, severityPolicyId: value.strength === "hard" ? "severity:blocking" : "severity:advisory", origin: { kind: "kicad_import", sourceId: input.sourceId, sourceRevision: input.sourceRevision }, evidenceIds: [], lifecycle: { state: "active" }, waiverPolicy: { eligible: false } });
      losses.push({ sourceId: `${input.sourceId}:${netClass.id}`, constraintIds: [id], disposition: value.strength === "hard" ? "transformed" : "exact", severity: "info", message: value.strength === "hard" ? "KiCad net-class clearance imported as a hard minimum." : "KiCad track/via net-class value imported as a soft preferred default, not a fabricated hard minimum." });
    }
  }
  return { document: { schemaVersion: 1, id: stableConstraintId("constraint-set-kicad-netclasses", input), revision: 1, name: "KiCad 10 net classes", extendsSetIds: [], constraints, relationships: [] }, losses };
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function mm(quantity: ConstraintQuantity): string {
  const nm = quantityToInteger(quantity, "length");
  const value = (nm / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${value}mm`;
}

function externalRequirement(requirement: TypedRequirement): string | null {
  if (requirement.form === "minimum") return `(min ${mm(requirement.value)})`;
  if (requirement.form === "maximum") return `(max ${mm(requirement.value)})`;
  if (requirement.form === "range") return `(min ${mm(requirement.min)}) (max ${mm(requirement.max)})`;
  return null;
}

const EXTERNAL_KIND: Partial<Record<ConstraintKind, string>> = {
  trace_width: "track_width",
  clearance: "clearance",
  via_diameter: "via_diameter",
  via_drill: "hole_size",
  annular_ring: "annular_width",
  edge_clearance: "edge_clearance",
  route_length: "length",
  pair_skew: "skew",
  via_count: "via_count",
};

export function exportKicadDru(input: { program: ConstraintProgram; stableNetNames: Record<string, string> }): KicadDruExportResult {
  const lines = ["(version 1)"];
  const losses: ConstraintAdapterLoss[] = [];
  for (const rule of input.program.effectiveRules) {
    const externalKind = EXTERNAL_KIND[rule.kind];
    const requirement = externalRequirement(rule.requirement);
    const netName = input.stableNetNames[rule.targetId];
    if (!externalKind || !requirement || !netName) {
      losses.push({ sourceId: rule.id, constraintIds: rule.contributingConstraintIds, disposition: "omitted", severity: rule.strength === "hard" ? "error" : "warning", message: `Rule ${rule.kind}/${rule.requirement.form} on ${rule.targetId} is not exactly representable in the bounded KiCad 10 export subset.` });
      continue;
    }
    const name = `Sirkit ${rule.kind} ${rule.id.slice(-8)}`;
    lines.push(
      `# Sirkit program ${input.program.programHash}; constraints ${rule.contributingConstraintIds.join(",")}`,
      `(rule ${quote(name)}`,
      `  (condition ${quote(`A.NetName == '${netName.replace(/'/g, "")}'`)})`,
      `  (constraint ${externalKind} ${requirement})`,
      `)`,
    );
    losses.push({ sourceId: rule.id, constraintIds: rule.contributingConstraintIds, disposition: "transformed", severity: "info", message: `Stable net ${rule.targetId} was snapshot-bound to external KiCad name '${netName}'. Rename requires re-export.` });
  }
  return { targetVersion: KICAD_CONSTRAINT_TARGET_VERSION, text: `${lines.join("\n")}\n`, verified: !losses.some((item) => item.severity === "error"), losses: losses.sort((a, b) => a.sourceId.localeCompare(b.sourceId)) };
}
