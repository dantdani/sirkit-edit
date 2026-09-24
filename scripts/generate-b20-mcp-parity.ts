/**
 * [B20 C1] Render the three-way parity of the MCP-exposed tools to its committed artifacts (OD-95).
 *
 *   npx tsx scripts/generate-b20-mcp-parity.ts [outDir]
 *
 * mcp-parity.json (the report as canonical JSON) and mcp-parity.md (the same report as a page) must byte-match this render
 * (CI gate in app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts, P9): a change to a descriptor, to the exposure
 * subset, to a provider rendering or to B1's MCP rendering changes them, so the change is reviewed here first. The render
 * refuses — and nothing is written, and the exit status is 1 — when the registry cannot be read, the listing refuses, the
 * agent declarations cannot be built, two ids map to one provider name, or a leg is missing.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sirkitToolRegistry } from "../app/lib/engineering/tool-catalog";
import { renderMcpParityJson, renderMcpParityMarkdown, renderMcpProviderParity } from "../app/lib/mcp/server/tool-parity";

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b20");
  const registry = sirkitToolRegistry();
  const report = renderMcpProviderParity(registry);
  const json = renderMcpParityJson(registry);
  const markdown = renderMcpParityMarkdown(registry);
  if (!report.ok || !json.ok || !markdown.ok) {
    console.error(`MCP parity render refused: ${report.ok ? (json.ok ? (markdown.ok ? "unknown" : markdown.code) : json.code) : report.code}`);
    process.exitCode = 1;
    return;
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "mcp-parity.json"), json.text, "utf8");
  await writeFile(resolve(outDir, "mcp-parity.md"), markdown.text, "utf8");
  const counts = report.report.counts;
  console.log(`Wrote the MCP three-way parity (${counts.mcpExposed} MCP-exposed of ${counts.agentExposed} agent-exposed, ${counts.agentOnly} agent-only; registry ${report.report.registryDigest}, listing ${report.report.listingDigest}) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
