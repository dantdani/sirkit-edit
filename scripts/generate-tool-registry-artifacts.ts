/**
 * B04 — deterministic tool-registry artifact generator.
 *
 * Regenerate with: npx tsx scripts/generate-tool-registry-artifacts.ts
 * CI byte-matches the committed artifacts against the registry rendering
 * (app/lib/engineering/__tests__/b04-tool-registry.test.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sirkitToolRegistry } from "../app/lib/engineering/tool-catalog";
import { renderNonCallableCoverageCsv, renderRegistryJson, renderToolRegistryCsv } from "../app/lib/engineering/tool-registry";
import { renderProviderParityReport } from "../app/lib/engineering/tool-provider-adapters";

const outDir = join(process.cwd(), "artifacts", "ai-control-plane-b04");
mkdirSync(outDir, { recursive: true });

const registry = sirkitToolRegistry();
writeFileSync(join(outDir, "tool-registry.csv"), renderToolRegistryCsv(registry));
writeFileSync(join(outDir, "non-callable-coverage.csv"), renderNonCallableCoverageCsv(registry));
writeFileSync(join(outDir, "provider-schema-parity.json"), renderRegistryJson(renderProviderParityReport(registry.list())));

const coverage = registry.coverageReport();
console.log(
  `Wrote ${coverage.descriptorCount} tool descriptors (${coverage.byCallability.callable} callable, ` +
  `${coverage.byCallability["not-callable"]} not-callable, ${coverage.agentExposedCount} agent-exposed) ` +
  `and provider parity for registry digest ${registry.digest()} to ${outDir}`,
);
