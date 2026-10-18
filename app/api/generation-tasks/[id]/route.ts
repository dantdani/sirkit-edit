/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md sections 6.1-6.2): GET /api/generation-tasks/[id] - the task's
 * snapshot (`sirkit.generation-task-snapshot.v1`, with the prompt for project members) and, with `include=result`, its validated result
 * (the netlist and notes the page's ONE review intake lays out). Scoped by the trusted context: an unknown, malformed or foreign id is the
 * same 404.
 */
import { authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { generationProviderServable } from "@/app/lib/generation-task/provider-servable"; // [PR-L, 2026-10-17] the servable rule without the generation import: this route never runs the build loop
import { resolveGenerationTaskService } from "@/app/lib/generation-task/runtime";
import { generationScopeOf } from "@/app/lib/generation-task/service";
import { generationAnswer, generationNotFound, generationStoreUnavailable } from "@/app/lib/generation-task/route-support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = authenticatedRoute({ routeParams: ["id"], query: true }, async ({ context, params, meta }) => {
  const service = resolveGenerationTaskService({ providerServable: (provider) => generationProviderServable(provider) });
  if (!service) return generationStoreUnavailable();
  const scope = generationScopeOf(context);
  if (!scope) return generationNotFound();
  return generationAnswer(await service.inspect(scope, params!.id!, { includeResult: meta.query?.include === "result" }));
});
