/**
 * [B20 B1] Render the MCP tool manifest of Sirkit's own registry to its committed artifacts.
 *
 *   npx tsx scripts/generate-b20-mcp-tool-manifest.ts [outDir]
 *
 * mcp-tool-manifest.csv (one row per registry descriptor: classification, exposure, closed exclusion reason, derived hints,
 * output-schema decision) and mcp-tool-manifest.json (the rendered listing: tools, listing digest, registry digest,
 * excluded) must byte-match this render (CI gate in app/lib/mcp/server/__tests__/b20-b1-tool-definitions.test.ts): a change
 * to an exposed descriptor, to the exposure subset or to the registry changes them, so the change is reviewed here first.
 * The render refuses (and nothing is written) when the exposure report is not ok (the structural rule and the reviewed
 * decision in mcp-exposure-review.ts disagree).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sirkitToolRegistry } from "../app/lib/engineering/tool-catalog";
import { renderMcpToolListing, renderMcpToolManifestCsv, renderMcpToolManifestJson } from "../app/lib/mcp/server/tool-definitions";

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b20");
  const registry = sirkitToolRegistry();
  const listing = renderMcpToolListing(registry);
  const csv = renderMcpToolManifestCsv(registry);
  const json = renderMcpToolManifestJson(registry);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "mcp-tool-manifest.csv"), csv, "utf8");
  await writeFile(resolve(outDir, "mcp-tool-manifest.json"), json, "utf8");
  console.log(`Wrote the MCP tool manifest (${listing.tools.length} exposed, ${listing.excluded.length} excluded; registry ${listing.registryDigest}, listing ${listing.listingDigest}) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
