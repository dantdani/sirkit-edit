/**
 * [B17-A] Regenerate the UI control inventory: every actionable control the
 * scanner finds, classified by the control registry, plus a summary.
 *
 *   npx tsx scripts/generate-b17-control-inventory.ts [outDir]
 *
 * The committed inventory must byte-match this render (CI gate in
 * app/lib/engineering/__tests__/b17-a-control-inventory.test.ts): a new or
 * changed control changes the CSV, so the change is reviewed here first.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scanControlSites } from "../app/lib/engineering/control-surface";
import { classifyControlSites, renderControlInventoryCsv, summarizeControlInventory, validateControlRules } from "../app/lib/engineering/control-registry";

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b17");
  const ruleErrors = validateControlRules();
  if (ruleErrors.length > 0) throw new Error(`Invalid control rules:\n${ruleErrors.join("\n")}`);
  const sites = scanControlSites(process.cwd());
  const { classified, unmatched, unusedRules } = classifyControlSites(sites);
  if (unmatched.length > 0) throw new Error(`Unclassified controls (add a rule in app/lib/engineering/control-registry.ts):\n${unmatched.map((site) => `  ${site.key} (line ${site.line})`).join("\n")}`);
  if (unusedRules.length > 0) throw new Error(`Stale rules (no control matches):\n${unusedRules.map((rule) => `  ${rule.id}`).join("\n")}`);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "ui-control-inventory.csv"), renderControlInventoryCsv(classified), "utf8");
  await writeFile(resolve(outDir, "ui-control-inventory-summary.json"), JSON.stringify(summarizeControlInventory(classified), null, 2) + "\n", "utf8");
  console.log(`Wrote ${classified.length} classified controls (${new Set(classified.map((row) => row.surface)).size} surfaces) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
