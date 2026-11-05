/**
 * [PR-F] Regenerate the ROUTING CAPABILITY MATRIX (the owner's Astra directive, section 10): for each constraint kind the constraint /
 * intent / stackup schemas can express, whether it survives EXPORT (the DSN writer), ROUTING (FreeRouting's rules), IMPORT (the SES
 * reader) and the INDEPENDENT CHECK (DRC / connectivity / the compiled constraint checks / the placement validator), each cell citing
 * the file:line it was read from.
 *
 *   pnpm exec tsx scripts/generate-pr-f-routing-capability-matrix.ts [outDir]
 *
 * Writes artifacts/product-reliability-simple-ui/astra/routing-capability-matrix.csv and routing-capability-matrix-summary.json
 * deterministically (stable row order, LF, no timestamps). The rows and their anchors live in
 * app/lib/pcb/experiments/routing-capability-matrix.ts; this script resolves every anchor against the current tree (a missing anchor
 * or an unknown constraint kind refuses the render - nothing is written) and the gate in
 * app/lib/pcb/experiments/__tests__/pr-f-capability-matrix.test.ts byte-compares the committed files with this render, so a moved
 * line or a changed enforcement entry is reviewed here first. Importing this module from a test is side-effect free (the
 * generate-pr-d-coverage-matrix precedent).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderRoutingCapabilityCsv, renderRoutingCapabilitySummary, resolveRoutingCapabilityMatrix, summarizeRoutingCapabilityMatrix, type ResolvedRoutingCapabilityMatrix, type RoutingCapabilitySummary } from "../app/lib/pcb/experiments/routing-capability-matrix";

export const PR_F_ROUTING_MATRIX_DIR = "artifacts/product-reliability-simple-ui/astra";
export const PR_F_ROUTING_MATRIX_CSV = "routing-capability-matrix.csv";
export const PR_F_ROUTING_MATRIX_SUMMARY = "routing-capability-matrix-summary.json";

/** A repository file's text (LF-normalized), or null when it is not in the tree. */
export function readRepoFile(cwd: string, file: string): string | null {
  const path = resolve(cwd, ...file.split("/"));
  return existsSync(path) ? readFileSync(path, "utf8").replaceAll("\r\n", "\n") : null;
}

export interface GeneratedRoutingCapabilityMatrix {
  resolved: ResolvedRoutingCapabilityMatrix;
  csv: string;
  summary: RoutingCapabilitySummary;
  summaryJson: string;
}

/** Generate the matrix in memory from the current tree (the gate compares this with the committed artifacts byte for byte). */
export function generateRoutingCapabilityMatrix(cwd: string): GeneratedRoutingCapabilityMatrix {
  const resolved = resolveRoutingCapabilityMatrix((file) => readRepoFile(cwd, file));
  const summary = summarizeRoutingCapabilityMatrix(resolved.rows);
  return { resolved, csv: renderRoutingCapabilityCsv(resolved.rows), summary, summaryJson: renderRoutingCapabilitySummary(summary) };
}

// Run only as a script (tsx) - importing this module from a test is side-effect free.
const invokedAsScript = Boolean(process.argv[1] && process.argv[1].replace(/\\/g, "/").includes("generate-pr-f-routing-capability-matrix"));
if (invokedAsScript) {
  const cwd = process.cwd();
  const outDir = resolve(cwd, process.argv[2] ?? PR_F_ROUTING_MATRIX_DIR);
  const generated = generateRoutingCapabilityMatrix(cwd);
  if (generated.resolved.problems.length > 0) throw new Error(`the matrix cannot be derived from the current tree:\n${generated.resolved.problems.map((problem) => `  ${problem}`).join("\n")}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, PR_F_ROUTING_MATRIX_CSV), generated.csv, "utf8");
  writeFileSync(join(outDir, PR_F_ROUTING_MATRIX_SUMMARY), generated.summaryJson, "utf8");
  process.stdout.write(`Wrote ${generated.summary.rows} rows (${generated.summary.citations} citations) to ${outDir}\n${Object.entries(generated.summary.byVerdict).map(([verdict, count]) => `  ${verdict}: ${count}`).join("\n")}\n`);
}
