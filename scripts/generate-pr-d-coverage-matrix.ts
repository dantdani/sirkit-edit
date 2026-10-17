/**
 * [PR-D] Regenerate the UI <-> AI command coverage matrix (assignment D.1 / D.2 / D.10):
 * every action-registry record, every classified B17 control site and every tool
 * descriptor, each with its derived disposition and reason, plus a summary.
 *
 *   pnpm exec tsx scripts/generate-pr-d-coverage-matrix.ts [outDir]
 *
 * Writes artifacts/product-reliability-simple-ui/ui-agent-command-coverage.csv and
 * ui-agent-command-coverage-summary.json deterministically (stable ordering, LF, no
 * timestamps). The committed artifacts must byte-match this render (the gate in
 * app/lib/engineering/__tests__/pr-d-coverage-matrix.test.ts): a new actionable
 * control, route or tool changes the render, so the change is reviewed here first.
 * Importing this module from a test is side-effect free (the generate-b16-0-4 precedent).
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { classifyControlSites, validateControlRules, type ClassifiedControl } from "../app/lib/engineering/control-registry";
import { scanControlSites } from "../app/lib/engineering/control-surface";
import { buildParityMatrix, buildTestEvidenceIndex, parityMatrixIds, renderParityMatrixCsv, renderParityMatrixSummary, summarizeParityMatrix, type ParityMatrixSummary, type ParityRow, type TestEvidenceIndex } from "../app/lib/engineering/parity-matrix";

export const PR_D_COVERAGE_ARTIFACT_DIR = "artifacts/product-reliability-simple-ui";
export const PR_D_COVERAGE_CSV = "ui-agent-command-coverage.csv";
export const PR_D_COVERAGE_SUMMARY = "ui-agent-command-coverage-summary.json";

/** The test corpus the `tests` column searches: every file under an `app/**\/__tests__/` directory and every file under `e2e/`. */
export const TEST_EVIDENCE_ROOTS = Object.freeze(["app", "e2e"] as const);

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries.sort()) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out); else if (stats.isFile()) out.push(full);
  }
}

/** Every test-evidence file (repo-relative POSIX paths): files under any `__tests__` directory below `app/`, and every file under `e2e/`. */
export function listTestEvidenceFiles(cwd: string): string[] {
  const files: string[] = [];
  for (const root of TEST_EVIDENCE_ROOTS) walk(resolve(cwd, root), files);
  return files
    .map((file) => relative(cwd, file).split(sep).join("/"))
    .filter((file) => file.startsWith("e2e/") || /(^|\/)__tests__\//.test(file))
    .sort();
}

export function readTestEvidenceIndex(cwd: string, ids: Iterable<string>): TestEvidenceIndex {
  const files = listTestEvidenceFiles(cwd).map((path) => ({ path, text: readFileSync(resolve(cwd, path), "utf8") }));
  return buildTestEvidenceIndex(files, ids);
}

/** The B17 inventory as the generator and the gate both derive it (scan + classify; refuses an unclassified control or a stale rule). */
export function scanClassifiedControls(cwd: string): ClassifiedControl[] {
  const ruleErrors = validateControlRules();
  if (ruleErrors.length > 0) throw new Error(`Invalid control rules:\n${ruleErrors.join("\n")}`);
  const { classified, unmatched, unusedRules } = classifyControlSites(scanControlSites(cwd));
  if (unmatched.length > 0) throw new Error(`Unclassified controls (add a rule in app/lib/engineering/control-registry.ts):\n${unmatched.map((site) => `  ${site.key} (line ${site.line})`).join("\n")}`);
  if (unusedRules.length > 0) throw new Error(`Stale rules (no control matches):\n${unusedRules.map((rule) => `  ${rule.id}`).join("\n")}`);
  return classified;
}

export interface GeneratedCoverageMatrix {
  controls: ClassifiedControl[];
  rows: ParityRow[];
  csv: string;
  summary: ParityMatrixSummary;
  summaryJson: string;
}

/** Generate the matrix in memory from the current tree (the gate compares this with the committed artifacts byte for byte). */
export function generateCoverageMatrix(cwd: string, controls: ClassifiedControl[] = scanClassifiedControls(cwd)): GeneratedCoverageMatrix {
  const tests = readTestEvidenceIndex(cwd, parityMatrixIds());
  const rows = buildParityMatrix({ controls, tests });
  const summary = summarizeParityMatrix(rows, { controls });
  return { controls, rows, csv: renderParityMatrixCsv(rows), summary, summaryJson: renderParityMatrixSummary(summary) };
}

// Run only as a script (tsx) - importing this module from a test is side-effect free.
const invokedAsScript = Boolean(process.argv[1] && process.argv[1].replace(/\\/g, "/").includes("generate-pr-d-coverage-matrix"));
if (invokedAsScript) {
  const cwd = process.cwd();
  const outDir = resolve(cwd, process.argv[2] ?? PR_D_COVERAGE_ARTIFACT_DIR);
  const generated = generateCoverageMatrix(cwd);
  if (generated.summary.unexplained > 0) throw new Error(`${generated.summary.unexplained} row(s) without a disposition or a reason`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, PR_D_COVERAGE_CSV), generated.csv, "utf8");
  writeFileSync(join(outDir, PR_D_COVERAGE_SUMMARY), generated.summaryJson, "utf8");
  const { byKind, byDisposition } = generated.summary;
  process.stdout.write(`Wrote ${generated.rows.length} rows (${byKind.action} action, ${byKind.control} control, ${byKind.tool} tool) to ${outDir}\n${Object.entries(byDisposition).map(([disposition, count]) => `  ${disposition}: ${count}`).join("\n")}\n`);
}
