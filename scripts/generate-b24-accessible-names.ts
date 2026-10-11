/**
 * [B24-D3] D24-32, OD-215 - render the accessible-name census to its committed artifacts:
 *
 *   pnpm exec tsx scripts/generate-b24-accessible-names.ts [outDir] [--bootstrap]
 *
 * Writes accessible-name-census.csv and accessible-name-census-summary.json (default outDir artifacts/ai-control-plane-b24); the
 * suite b24-d3-accessible-names byte-gates both against the same rendering (case 1), so a control that gains, loses or changes
 * its name is reviewed here first. The ratchet: it refuses to write (and exits non-zero) when a site the render calls `unnamed`
 * is not `unnamed` in the committed census - a new unnamed control anywhere is named (a visible <label>, htmlFor or an aria-label
 * worded for a person) before the census moves; and when a scope region of ACCESSIBILITY_SCOPE matches no element or several.
 * [B24-D3 review, 2026-10-10] correctness-1, security-1: the ratchet's baseline is always the census committed at the repository
 * path (CENSUS_PATH), whatever outDir says, and a missing baseline refuses too unless `--bootstrap` is given (the first census of a
 * tree that has none). The suite's frozen key list (case 3) stays the gate a regenerated census cannot move.
 * Every path it reads comes from the tree; output is byte-stable (LF).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { computeAccessibleNameCensus, renderAccessibleNameCensusCsv, summarizeAccessibleNameCensus, unnamedKeysOfCensusCsv } from "../app/lib/engineering/accessible-names";

/** The committed census, the ratchet's baseline (never read from outDir). */
const CENSUS_PATH = "artifacts/ai-control-plane-b24/accessible-name-census.csv";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bootstrap = args.includes("--bootstrap");
  const positional = args.filter((arg) => arg !== "--bootstrap");
  const outDir = resolve(process.cwd(), positional[0] ?? "artifacts/ai-control-plane-b24");
  const census = await computeAccessibleNameCensus(process.cwd());
  if (census.scopeProblems.length > 0) throw new Error(`Refused: nothing written. The scope does not resolve:\n${census.scopeProblems.join("\n")}`);
  const baselinePath = resolve(process.cwd(), CENSUS_PATH);
  if (existsSync(baselinePath)) {
    const committed = unnamedKeysOfCensusCsv(readFileSync(baselinePath, "utf8"));
    const added = census.rows.filter((row) => row.status === "unnamed" && !committed.has(row.key)).map((row) => `  ${row.key} (${row.surface}:${row.line}; ${row.detail})`);
    if (added.length > 0) throw new Error(`Refused: nothing written. New unnamed controls (name each one before the census moves):\n${added.join("\n")}`);
  } else if (!bootstrap) {
    throw new Error(`Refused: nothing written. No committed census at ${CENSUS_PATH} to ratchet against; restore it, or pass --bootstrap for a tree that has none.`);
  }
  const summary = summarizeAccessibleNameCensus(census);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "accessible-name-census.csv"), renderAccessibleNameCensusCsv(census.rows), "utf8");
  await writeFile(resolve(outDir, "accessible-name-census-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log(`Wrote the accessible-name census (${summary.sites} sites on ${summary.surfaces} surfaces; in scope ${summary.inScope.sites}, unnamed ${summary.inScope.byStatus.unnamed ?? 0}, structural problems ${summary.inScope.structuralProblems}; out of scope unnamed ${summary.outOfScope.unnamed}) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
