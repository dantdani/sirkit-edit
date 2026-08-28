/**
 * B05 — deterministic read-invocation artifact generator.
 *
 * Regenerate with: npx tsx scripts/generate-read-invocation-artifacts.ts
 * CI byte-matches the committed artifacts (b05 test suite). Also regenerates
 * the B04 artifacts, which change when catalog audit notes/schemas change.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIVATED_READ_BINDINGS } from "../app/lib/engineering/tool-bindings-readonly";
import { buildReadReplayFixtures } from "../app/lib/engineering/tool-read-replay";
import { sirkitToolRegistry } from "../app/lib/engineering/tool-catalog";
import { renderRegistryJson } from "../app/lib/engineering/tool-registry";

const outDir = join(process.cwd(), "artifacts", "ai-control-plane-b05");
const outDir51 = join(process.cwd(), "artifacts", "ai-control-plane-b05-1");
mkdirSync(outDir, { recursive: true });
mkdirSync(outDir51, { recursive: true });

const registry = sirkitToolRegistry();

const csvCell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const header = ["tool_id", "binding_id", "binding_version", "kind", "module", "symbol", "descriptor_match", "required_resources", "optional_resources"];
const rows = [...ACTIVATED_READ_BINDINGS]
  .sort((a, b) => a.toolId.localeCompare(b.toolId))
  .map((binding) => {
    const descriptor = registry.get(binding.toolId);
    const matches = descriptor?.binding.module === binding.module && descriptor?.binding.symbol === binding.symbol;
    return [binding.toolId, binding.bindingId, binding.bindingVersion, binding.kind, binding.module, binding.symbol, String(matches), [...binding.requiredResources].join(";"), [...(binding.optionalResources ?? [])].join(";")];
  });
writeFileSync(join(outDir, "activated-read-bindings.csv"), [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");

// B05.1: per-binding resource-consumption matrix.
const matrixHeader = ["tool_id", "binding_id", "resource_kind", "requirement"];
const matrixRows = [...ACTIVATED_READ_BINDINGS]
  .sort((a, b) => a.toolId.localeCompare(b.toolId))
  .flatMap((binding) => [
    ...[...binding.requiredResources].sort().map((kind) => [binding.toolId, binding.bindingId, kind, "required"]),
    ...[...(binding.optionalResources ?? [])].sort().map((kind) => [binding.toolId, binding.bindingId, kind, "optional"]),
  ]);
writeFileSync(join(outDir51, "resource-consumption-matrix.csv"), [matrixHeader, ...matrixRows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");

void buildReadReplayFixtures().then((fixtures) => {
  writeFileSync(join(outDir, "read-replay-fixtures.json"), renderRegistryJson({ schema: "sirkit.read-replay-fixtures.v2", fixtures }));
  // Composite subset: fixtures consuming auxiliary authority resources.
  const composite = fixtures.filter((fixture) => fixture.expectedVerification === "composite-resources-verified");
  writeFileSync(join(outDir51, "composite-replay-fixtures.json"), renderRegistryJson({ schema: "sirkit.composite-replay-fixtures.v1", fixtures: composite }));
  console.log(`Wrote ${rows.length} activated read bindings, ${fixtures.length} replay fixtures (${composite.length} composite) to ${outDir} / ${outDir51}`);
});
