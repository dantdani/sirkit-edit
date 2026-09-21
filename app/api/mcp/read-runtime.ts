/**
 * [B20 B3] The composition root of MCP reads (D-12): the ONE module in the MCP tree that reaches the durable workflow runtime,
 * the server-owned component-authority runtime and the membership runtime (b20-b3-import-gates G5), as
 * `app/api/chat/component-authority-runtime.ts` is for the chat route. The route resolves the dependencies inside the
 * authenticated wrapper callback only, never at module scope.
 *
 * The production default reads the durable repository through a READ-ONLY view (every write refused without delegating),
 * resolves component authority from the same server-owned source the chat route uses, re-reads membership through the
 * identity runtime, and uses the server clock and a cryptographic random source. Construction does no I/O: the repository
 * reaches the database only when a read calls it (never in a test: the suites install the factory seam). Anything that
 * fails to construct answers null, and a read then refuses `durable_board_unavailable`.
 */
import { randomBytes } from "node:crypto";
import { resolveComponentAuthoritySource } from "@/app/api/chat/component-authority-runtime";
import { resolveMembershipRepository } from "@/app/lib/auth/identity-runtime";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import type { DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { createDurableBoardReader, readOnlyDurableWorkflow } from "@/app/lib/engineering/durable-read-bundle";
import { membershipReverifier, type McpReadDependencies } from "@/app/lib/mcp/server/read-call";

/** The production durable repository, as MCP reads see it: read-only. */
export function productionMcpReadWorkflow(): DurableWorkflowRepository {
  return readOnlyDurableWorkflow(getDurableWorkflowRepository());
}

function productionDependencies(): McpReadDependencies {
  return {
    boardReader: createDurableBoardReader(productionMcpReadWorkflow()),
    componentAuthority: (scope) => resolveComponentAuthoritySource(scope),
    membership: membershipReverifier(resolveMembershipRepository),
    now: () => Date.now(),
    randomBytes: (size) => new Uint8Array(randomBytes(size)),
  };
}

const DEFAULT_FACTORY: () => McpReadDependencies | null = productionDependencies;
let factory = DEFAULT_FACTORY;

/** Test seam: replace the whole dependency set (restore with `resetMcpReadDependenciesFactory`). */
export function setMcpReadDependenciesFactory(next: () => McpReadDependencies | null): void {
  factory = next;
}
/** Restore the production default. */
export function resetMcpReadDependenciesFactory(): void {
  factory = DEFAULT_FACTORY;
}
/** The dependencies of MCP reads, or null (a read then refuses durable_board_unavailable). Never throws. */
export function resolveMcpReadDependencies(): McpReadDependencies | null {
  try {
    return factory();
  } catch {
    return null;
  }
}
