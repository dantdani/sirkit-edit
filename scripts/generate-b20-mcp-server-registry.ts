/**
 * [B20 A0] Render the versioned MCP server registry to its committed artifact.
 *
 *   npx tsx scripts/generate-b20-mcp-server-registry.ts [outDir]
 *
 * The committed CSV must byte-match this render (CI gate in app/lib/mcp/__tests__/b20-a0-server-registry.test.ts): any
 * change to a server's identity, canonical URI, protocol versions, secret references, descriptor pin, limits, terms or
 * state changes the CSV, so the change is reviewed here first. The registry is empty (OD-48): the render is the header
 * line alone until a reviewed row is added.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MCP_SERVER_IDS, MCP_SERVER_REGISTRY_VERSION, renderMcpServerRegistryCsv, validateMcpServerRegistry } from "../app/lib/mcp/server-registry";

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b20");
  const violations = validateMcpServerRegistry();
  if (violations.length > 0) throw new Error(`Invalid MCP server registry:\n${violations.map((violation) => violation.message).join("\n")}`);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "mcp-server-registry.csv"), renderMcpServerRegistryCsv(), "utf8");
  console.log(`Wrote MCP server registry ${MCP_SERVER_REGISTRY_VERSION} (${MCP_SERVER_IDS.length} servers) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
